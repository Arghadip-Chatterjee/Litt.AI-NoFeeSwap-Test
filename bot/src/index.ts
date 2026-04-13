/**
 * bot/src/index.ts
 * NoFeeSwap Sandwich Attack Bot — Entry Point
 *
 * Architecture:
 *   MempoolMonitor → decoder → simulator → SandwichAttacker
 *
 * Usage:
 *   BOT_PRIVATE_KEY=0x... npx ts-node src/index.ts
 *
 * Requirements:
 *   - Hardhat node running at ws://localhost:8545
 *   - deployments.json populated by scripts/deploy.py
 */

import { ethers } from 'ethers';
import { MempoolMonitor } from './mempool';
import { decodeSwapTx } from './decoder';
import { analyzeSandwich } from './simulator';
import { SandwichAttacker } from './attacker';
import { ADDRESSES } from './contracts';

// ── Config ────────────────────────────────────────────────────────────────
const RPC_URL    = process.env.RPC_URL    ?? 'http://127.0.0.1:8545';
const WS_URL     = process.env.WS_URL     ?? 'ws://127.0.0.1:8545';
// Hardhat account[2] private key (not account[0] or account[1] used in deployment)
const PRIVATE_KEY = process.env.BOT_PRIVATE_KEY
  ?? '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

// ── Banner ────────────────────────────────────────────────────────────────
function printBanner() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║       NoFeeSwap Sandwich Bot  v1.0.0                 ║
║       Target: ${ADDRESSES.nofeeswap.slice(0,16)}…          ║
║       Pool:   ${(ADDRESSES.poolId ?? '?').slice(0,16)}…          ║
╚══════════════════════════════════════════════════════╝
`);
}

// ── Statistics ────────────────────────────────────────────────────────────
const stats = {
  txSeen:       0,
  swapsSeen:    0,
  sandwichAttempts: 0,
  successes:    0,
  totalProfit:  0n,
};

function printStats() {
  console.log(`\n[stats] ─────────────────────────────────────────`);
  console.log(`  Transactions seen:      ${stats.txSeen}`);
  console.log(`  Swap txs detected:      ${stats.swapsSeen}`);
  console.log(`  Sandwich attempts:      ${stats.sandwichAttempts}`);
  console.log(`  Successful sandwiches:  ${stats.successes}`);
  console.log(`  Total profit (est.):    ${ethers.formatEther(stats.totalProfit)} ETH`);
  console.log(`─────────────────────────────────────────────────\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  if (!ADDRESSES.nofeeswap || ADDRESSES.nofeeswap === '0x0000000000000000000000000000000000000000') {
    console.error('❌ ERROR: deployments.json not found or empty.');
    console.error('   Run: d:\\Litt.AI\\.venv-nofeeswap\\Scripts\\brownie run scripts/deploy.py --network hardhat');
    console.error('   from d:\\Litt.AI\\contracts\\core first.');
    process.exit(1);
  }

  // ── Setup providers ────────────────────────────────────────────────────
  const httpProvider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, httpProvider);

  const chainId = (await httpProvider.getNetwork()).chainId;
  console.log(`[bot] Connected to chain ${chainId}`);
  console.log(`[bot] Bot wallet: ${wallet.address}`);

  const balance = await httpProvider.getBalance(wallet.address);
  console.log(`[bot] ETH balance: ${ethers.formatEther(balance)} ETH`);

  // ── Setup attacker ─────────────────────────────────────────────────────
  const attacker = new SandwichAttacker(wallet, httpProvider);

  // ── Gas price baseline ─────────────────────────────────────────────────
  const feeData = await httpProvider.getFeeData();
  const baseGasPrice = feeData.gasPrice ?? ethers.parseUnits('1', 'gwei');
  console.log(`[bot] Base gas price: ${ethers.formatUnits(baseGasPrice, 'gwei')} gwei\n`);

  // ── Start mempool monitor ──────────────────────────────────────────────
  const monitor = new MempoolMonitor(WS_URL, async (tx) => {
    stats.txSeen++;

    // Decode: is this a NoFeeSwap swap?
    const decoded = decodeSwapTx(tx);
    if (!decoded) return;

    stats.swapsSeen++;
    console.log(`\n[bot] 🎯 Swap detected! tx: ${tx.hash.slice(0, 14)}…`);
    console.log(`  Pool:            ${decoded.poolId.toString(16).slice(0, 16)}…`);
    console.log(`  AmountSpecified: ${decoded.amountSpecified}`);
    console.log(`  ZeroForOne:      ${decoded.zeroForOne}`);
    console.log(`  From:            ${decoded.txFrom}`);
    console.log(`  Gas Price:       ${ethers.formatUnits(decoded.txGasPrice, 'gwei')} gwei`);

    // Simulate profitability
    const walletBalance = await httpProvider.getBalance(wallet.address);
    const analysis = await analyzeSandwich(httpProvider, decoded, walletBalance, baseGasPrice);

    console.log(`  📊 Analysis: ${analysis.profitable ? '✅ PROFITABLE' : '❌ Not profitable'}`);
    console.log(`  Reasoning: ${analysis.reasoning}`);

    if (!analysis.profitable) return;

    // Execute sandwich
    stats.sandwichAttempts++;
    console.log(`\n[bot] ⚔️  Executing sandwich attack…`);
    console.log(`  Front-run size:  ${ethers.formatEther(analysis.frontrunAmount)} tokens`);
    console.log(`  Front-run gas:   ${ethers.formatUnits(analysis.frontrunGasPrice, 'gwei')} gwei`);
    console.log(`  Back-run gas:    ${ethers.formatUnits(analysis.backrunGasPrice, 'gwei')} gwei`);

    const result = await attacker.executeSandwich(decoded, analysis);

    if (result.success) {
      stats.successes++;
      stats.totalProfit += result.actualProfit ?? 0n;
      console.log(`\n[bot] 💰 Sandwich SUCCESS!`);
      console.log(`  Front-run: ${result.frontrunHash?.slice(0,18)}…`);
      console.log(`  Back-run:  ${result.backrunHash?.slice(0,18)}…`);
      console.log(`  Profit:    ${ethers.formatEther(result.actualProfit ?? 0n)} ETH`);
    } else {
      console.log(`\n[bot] ❌ Sandwich FAILED: ${result.error}`);
    }

    printStats();
  });

  await monitor.start();

  // Print stats every 30s
  setInterval(printStats, 30_000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[bot] Shutting down…');
    printStats();
    await monitor.stop();
    process.exit(0);
  });

  console.log('[bot] 👀 Watching mempool. Press Ctrl+C to stop.\n');
}

main().catch((err) => {
  console.error('[bot] Fatal error:', err);
  process.exit(1);
});

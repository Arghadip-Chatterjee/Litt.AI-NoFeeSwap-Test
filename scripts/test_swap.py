"""
scripts/test_swap.py
────────────────────
Quick smoke-test: submits a 0.1 token swap through the deployed Operator
so the sandwich bot can detect and react to it.

Usage (from d:\\Litt.AI\\contracts\\core with venv active):
  brownie run ../../scripts/test_swap.py --network hardhat
"""

from brownie import interface, accounts, network  # type: ignore[import] — installed in .venv-nofeeswap
import json
import os

# ── Load deployments ──────────────────────────────────────────────────────
ROOT = os.path.join(os.path.dirname(__file__), '..', 'deployments.json')

def load_deployments():
    with open(ROOT) as f:
        return json.load(f)

# ── Minimal ABIs ─────────────────────────────────────────────────────────
NOFEESWAP_ABI = json.loads('[{"name":"unlock","type":"function","inputs":[{"name":"target","type":"address"},{"name":"data","type":"bytes"}],"outputs":[{"type":"bytes"}],"stateMutability":"nonpayable"}]')
OPERATOR_ABI  = json.loads('[{"name":"swap","type":"function","inputs":[{"name":"poolId","type":"uint256"},{"name":"amountSpecified","type":"int256"},{"name":"logPriceLimit","type":"int256"},{"name":"zeroForOne","type":"uint256"},{"name":"recipient","type":"address"},{"name":"deadline","type":"uint256"},{"name":"hookData","type":"bytes"}],"outputs":[],"stateMutability":"nonpayable"}]')
ERC20_ABI     = json.loads('[{"name":"approve","type":"function","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"type":"bool"}]},{"name":"balanceOf","type":"function","inputs":[{"name":"account","type":"address"}],"outputs":[{"type":"uint256"}],"stateMutability":"view"}]')

def main():
    d = load_deployments()

    nofeeswap = d['contracts']['nofeeswap']
    operator  = d['contracts']['operator']
    token0    = d['contracts']['token0']
    token1    = d['contracts']['token1']
    pool_id   = int(d['pool']['poolId'], 16)

    # Use Hardhat account[1] as the "victim" (account[0] is deployer, [2] is bot)
    victim = accounts[1]
    print(f"[test_swap] Victim:    {victim}")
    print(f"[test_swap] nofeeswap: {nofeeswap}")
    print(f"[test_swap] pool_id:   {hex(pool_id)[:20]}…")

    from web3 import Web3
    w3 = Web3(Web3.HTTPProvider('http://127.0.0.1:8545'))

    # Clear mempool of any stuck transactions from previous test runs
    w3.provider.make_request("evm_mine", [])

    # Approve operator to spend token0
    tk0 = interface.ERC20(token0)
    tk0.approve(operator, 2**256 - 1, {'from': victim, 'gas_price': '2000000000'})
    print(f"[test_swap] token0 balance: {tk0.balanceOf(victim)}")

    # Build swap calldata: swap 1e17 token0 for token1, 0.5% slippage
    AMOUNT      = 10**17                         # 0.1 token0
    ZERO_FOR_ONE = 1                              # buying token1 with token0
    PRICE_LIMIT = -(2**64 - 1)                   # MAX slippage (no limit) for smoke-test
    DEADLINE    = 2**256 - 1

    from eth_abi import encode  # type: ignore[import] — available in .venv-nofeeswap

    # Encode operator.swap() inner calldata
    swap_selector = bytes.fromhex('aabbccdd')      # placeholder — use real selector
    inner = encode(
        ['uint256', 'int256', 'int256', 'uint256', 'address', 'uint256', 'bytes'],
        [pool_id, AMOUNT, PRICE_LIMIT, ZERO_FOR_ONE, victim.address, DEADLINE, b'']
    )

    # Build the full unlock call
    unlock_iface = interface.Nofeeswap(nofeeswap)  # uses NOFEESWAP_ABI above
    tx = unlock_iface.unlock(operator, inner, {'from': victim, 'gas_price': '1500000000'})

    print(f"[test_swap] ✅ Swap tx submitted: {tx.txid}")
    print(f"[test_swap] Gas used: {tx.gas_used}")

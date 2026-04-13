"""
scripts/test_proper_swap.py
---------------------------
Smoke-test using the CORRECT swapSequence VM bytecode from
contracts/operator/tests/Nofee.py — not the broken ABI-encode approach.

Run from d:\Litt.AI:
  .venv-nofeeswap\Scripts\python.exe scripts/test_proper_swap.py
"""

import sys, os, json, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'contracts', 'operator', 'tests'))
from Nofee import swapSequence, address0   # type: ignore

from web3 import Web3
from eth_account import Account

ROOT = os.path.join(os.path.dirname(__file__), '..', 'deployments.json')

# ── Hardhat account[1] private key ────────────────────────────────────────
VICTIM_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
# ── Hardhat account[2] for the bot (just need any funded acct) ───────────

# ── Load deployments ──────────────────────────────────────────────────────
with open(ROOT) as f:
    d = json.load(f)

NOFEESWAP = Web3.to_checksum_address(d['contracts']['nofeeswap'])
OPERATOR  = Web3.to_checksum_address(d['contracts']['operator'])
TOKEN0    = Web3.to_checksum_address(d['contracts']['token0'])
TOKEN1    = Web3.to_checksum_address(d['contracts']['token1'])
POOL_ID   = int(d['pool']['poolId'], 16)

w3  = Web3(Web3.HTTPProvider('http://127.0.0.1:8545'))
acc = Account.from_key(VICTIM_KEY)
VICTIM = acc.address
print(f"[test] Victim  : {VICTIM}")
print(f"[test] nofeeswap: {NOFEESWAP}")
print(f"[test] operator : {OPERATOR}")
print(f"[test] poolId   : {hex(POOL_ID)[:24]}…")

# ── Minimal ABIs ─────────────────────────────────────────────────────────
ERC20_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "a", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"name": "approve",   "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "s", "type": "address"}, {"name": "v", "type": "uint256"}],
     "outputs": [{"type": "bool"}]},
    {"name": "allowance", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "o", "type": "address"}, {"name": "s", "type": "address"}],
     "outputs": [{"type": "uint256"}]},
]
NOFEESWAP_ABI = [
    {"name": "unlock",      "type": "function", "stateMutability": "payable",
     "inputs": [{"name": "t", "type": "address"}, {"name": "d", "type": "bytes"}],
     "outputs": [{"type": "bytes"}]},
    {"name": "setOperator", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "op", "type": "address"}, {"name": "approved", "type": "bool"}],
     "outputs": []},
    {"name": "isOperator",  "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}, {"name": "op", "type": "address"}],
     "outputs": [{"type": "bool"}]},
]

nfs  = w3.eth.contract(address=NOFEESWAP, abi=NOFEESWAP_ABI)
tk0  = w3.eth.contract(address=TOKEN0,    abi=ERC20_ABI)
tk1  = w3.eth.contract(address=TOKEN1,    abi=ERC20_ABI)

def send(fn, gas=500_000):
    """Sign and send a transaction, mine it immediately."""
    nonce = w3.eth.get_transaction_count(VICTIM)
    tx    = fn.build_transaction({
        'from': VICTIM, 'nonce': nonce,
        'gas': gas, 'gasPrice': w3.to_wei('2', 'gwei'),
    })
    signed = w3.eth.account.sign_transaction(tx, VICTIM_KEY)
    raw = signed.raw_transaction if hasattr(signed, 'raw_transaction') else signed.rawTransaction
    h = w3.eth.send_raw_transaction(raw)
    w3.provider.make_request("evm_mine", [])  # force-mine immediately
    receipt = w3.eth.wait_for_transaction_receipt(h, timeout=10)
    return h.hex(), receipt

# ─────────────────────────────────────────────────────────────────────────
print("\n[1] Checking token balances...")
b0_before = tk0.functions.balanceOf(VICTIM).call()
b1_before = tk1.functions.balanceOf(VICTIM).call()
print(f"  token0 balance: {b0_before/1e18:.4f}")
print(f"  token1 balance: {b1_before/1e18:.4f}")

# [2] Ensure operator is approved
print("\n[2] Setting operator approval...")
is_op = nfs.functions.isOperator(VICTIM, OPERATOR).call()
print(f"  isOperator before: {is_op}")
if not is_op:
    h, r = send(nfs.functions.setOperator(OPERATOR, True))
    print(f"  setOperator tx: {h}  status={r['status']}")
    if r['status'] != 1:
        print("  ERROR: setOperator FAILED")
        sys.exit(1)

# [3] Approve operator to spend token0
print("\n[3] Approving token0 -> operator...")
allowance0 = tk0.functions.allowance(VICTIM, OPERATOR).call()
print(f"  current allowance: {allowance0}")
if allowance0 < 10**18:
    h, r = send(tk0.functions.approve(OPERATOR, 2**256 - 1))
    print(f"  approve tx: {h}  status={r['status']}")

# [4] Build the proper swapSequence and call unlock
print("\n[4] Building VM bytecode via swapSequence()...")
AMOUNT       = -(10**17)       # negative = exact input of token0 (exact-in convention)
ZERO_FOR_ONE = 2               # 2 = auto-detect direction from limit
# Pool lower=9223372036854775808 upper=9234900675478518608
# limitOffsetted = limit + 2^63. We want price to go DOWN (below current ~9229136356166647208)
# so set limitOffsetted to: lower + 1 (just above lower bound)
# limit = limitOffsetted - 2^63 = (lowerTick + 1) - 2^63 = 1
LOWER = 9223372036854775808    # from deployments.json
LIMIT        = LOWER + 1 - (1 << 63)   # = 1 (just above absolute lower bound -> swap all in-range)
DEADLINE     = int(time.time()) + 300

# swapSequence(nofeeswap, token0, token1, payer, poolId, amountSpecified, limit, zeroForOne, hookData, deadline)
class FakeContract:
    """Lightweight wrapper so swapSequence can access .address"""
    def __init__(self, addr): self.address = addr

data = swapSequence(
    FakeContract(NOFEESWAP),
    FakeContract(TOKEN0),
    FakeContract(TOKEN1),
    FakeContract(VICTIM),
    POOL_ID,
    AMOUNT,
    LIMIT,
    ZERO_FOR_ONE,
    b'',
    DEADLINE,
)
print(f"  bytecode length: {len(data)} bytes")
print(f"  first 8 bytes: {data[:8].hex()}")

# Try simulate first
print("\n[5] Simulating via raw eth_call (no ABI decoding)...")
try:
    # Use eth_call directly to avoid ABI decode error (unlock returns raw bytes, not ABI-encoded)
    encoded = nfs.encodeABI(fn_name='unlock', args=[OPERATOR, data])
    result_hex = w3.eth.call({'to': NOFEESWAP, 'from': VICTIM, 'data': encoded})
    print(f"  Simulation raw result: {result_hex.hex()!r} ({len(result_hex)} bytes)")
    if len(result_hex) == 0:
        print("  Note: unlock returned 0 bytes (expected — Nofeeswap returns raw operator result)")
except Exception as e:
    print(f"  Simulation error: {e}")

# [6] Submit the swap
print("\n[6] Submitting swap transaction...")
try:
    h, r = send(nfs.functions.unlock(OPERATOR, data), gas=1_000_000)
    print(f"  tx: {h}")
    print(f"  status: {'SUCCESS' if r['status'] == 1 else 'REVERTED'}")
    print(f"  gasUsed: {r['gasUsed']}")
except Exception as e:
    print(f"  FAILED: {e}")
    sys.exit(1)

# [7] Check balances changed
print("\n[7] Checking balance changes...")
b0_after = tk0.functions.balanceOf(VICTIM).call()
b1_after = tk1.functions.balanceOf(VICTIM).call()
print(f"  token0: {b0_before/1e18:.4f} -> {b0_after/1e18:.4f}  (delta {(b0_after-b0_before)/1e18:+.6f})")
print(f"  token1: {b1_before/1e18:.4f} -> {b1_after/1e18:.4f}  (delta {(b1_after-b1_before)/1e18:+.6f})")
if b0_before != b0_after or b1_before != b1_after:
    print("\n  ✅ SWAP SUCCEEDED — balances changed!")
else:
    print("\n  ❌ No balance changes — swap did not execute")

"""
scripts/add_liquidity.py
------------------------
Adds initial liquidity to the deployed Nofeeswap pool using the
official operator mintSequence VM bytecode.

Run from d:\Litt.AI:
  .venv-nofeeswap\Scripts\python.exe scripts\add_liquidity.py
"""

import sys, os, json, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'contracts', 'operator', 'tests'))
from Nofee import mintSequence, keccak   # type: ignore

from web3 import Web3
from eth_account import Account

ROOT = os.path.join(os.path.dirname(__file__), '..', 'deployments.json')

# Hardhat account[1] — same wallet as MetaMask (owner / victim)
PROVIDER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

# ── Load deployments ──────────────────────────────────────────────────────
with open(ROOT) as f:
    d = json.load(f)

NOFEESWAP = Web3.to_checksum_address(d['contracts']['nofeeswap'])
OPERATOR  = Web3.to_checksum_address(d['contracts']['operator'])
TOKEN0    = Web3.to_checksum_address(d['contracts']['token0'])
TOKEN1    = Web3.to_checksum_address(d['contracts']['token1'])
POOL_ID   = int(d['pool']['poolId'], 16)
LOG_OFFSET = d['pool']['logOffset']
LOWER_TICK = d['pool']['lowerTick']
UPPER_TICK = d['pool']['upperTick']

w3  = Web3(Web3.HTTPProvider('http://127.0.0.1:8545'))
acc = Account.from_key(PROVIDER_KEY)
PROVIDER = acc.address

print("=" * 60)
print("[add_liquidity] NoFeeSwap Pool Liquidity Provider")
print("=" * 60)
print(f"  Provider  : {PROVIDER}")
print(f"  nofeeswap : {NOFEESWAP}")
print(f"  operator  : {OPERATOR}")
print(f"  poolId    : {hex(POOL_ID)[:24]}...")
print(f"  lowerTick : {LOWER_TICK}")
print(f"  upperTick : {UPPER_TICK}")
print(f"  logOffset : {LOG_OFFSET}")

# ── ABIs ──────────────────────────────────────────────────────────────────
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
     "outputs": []},
    {"name": "setOperator", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "op", "type": "address"}, {"name": "approved", "type": "bool"}],
     "outputs": []},
    {"name": "isOperator",  "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}, {"name": "op", "type": "address"}],
     "outputs": [{"type": "bool"}]},
]

nfs = w3.eth.contract(address=NOFEESWAP, abi=NOFEESWAP_ABI)
tk0 = w3.eth.contract(address=TOKEN0,    abi=ERC20_ABI)
tk1 = w3.eth.contract(address=TOKEN1,    abi=ERC20_ABI)

def send(fn, gas=800_000):
    """Sign, send, and mine a transaction."""
    nonce  = w3.eth.get_transaction_count(PROVIDER)
    tx     = fn.build_transaction({
        'from': PROVIDER, 'nonce': nonce,
        'gas': gas, 'gasPrice': w3.to_wei('2', 'gwei'),
    })
    signed = w3.eth.account.sign_transaction(tx, PROVIDER_KEY)
    raw    = signed.raw_transaction if hasattr(signed, 'raw_transaction') else signed.rawTransaction
    h      = w3.eth.send_raw_transaction(raw)
    w3.provider.make_request("evm_mine", [])
    receipt = w3.eth.wait_for_transaction_receipt(h, timeout=15)
    return h.hex(), receipt

# ── Step 1: ensure setOperator ────────────────────────────────────────────
print("\n[1] Checking operator authorization...")
is_op = nfs.functions.isOperator(PROVIDER, OPERATOR).call()
print(f"  isOperator: {is_op}")
if not is_op:
    h, r = send(nfs.functions.setOperator(OPERATOR, True))
    print(f"  setOperator tx: {h}  status={r['status']}")
    assert r['status'] == 1, "setOperator failed!"

# ── Step 2: approve tokens for operator ───────────────────────────────────
print("\n[2] Approving tokens for operator...")
MAX = 2**256 - 1
for (tk, sym) in [(tk0, 'token0'), (tk1, 'token1')]:
    bal = tk.functions.balanceOf(PROVIDER).call()
    alw = tk.functions.allowance(PROVIDER, OPERATOR).call()
    print(f"  {sym}: balance={bal/1e18:.2f}  allowance={alw/1e18:.2f}")
    if alw < 10**24:
        h, r = send(tk.functions.approve(OPERATOR, MAX))
        print(f"    approved: {h}  status={r['status']}")

# ── Step 3: build mint sequence ───────────────────────────────────────────
print("\n[3] Building mintSequence VM bytecode...")

# qMin/qMax in un-offsetted X59 log-price coordinates
# Formula: qMin = lowerTick - 2^63 + logOffset * 2^59
X63 = 1 << 63
X59 = 1 << 59
qMin = LOWER_TICK - X63 + LOG_OFFSET * X59
qMax = UPPER_TICK - X63 + LOG_OFFSET * X59

# LP share token tag = keccak256(poolId, qMin, qMax)
tagShares = keccak(['uint256', 'int256', 'int256'], [POOL_ID, qMin, qMax])

SHARES   = 10**27           # 1 billion LP shares (enough for testing)
DEADLINE = (2**32) - 1      # max uint32 — far future

print(f"  qMin      : {qMin}")
print(f"  qMax      : {qMax}")
print(f"  tagShares : 0x{tagShares:064x}")
print(f"  shares    : {SHARES}")

class FakeContract:
    def __init__(self, addr): self.address = addr

data = mintSequence(
    FakeContract(NOFEESWAP),
    FakeContract(TOKEN0),
    FakeContract(TOKEN1),
    tagShares,
    POOL_ID,
    qMin, qMax,
    SHARES,
    b'',
    DEADLINE,
)
print(f"  bytecode  : {len(data)} bytes")

# ── Step 4: check balances before ─────────────────────────────────────────
b0_before = tk0.functions.balanceOf(PROVIDER).call()
b1_before = tk1.functions.balanceOf(PROVIDER).call()
print(f"\n[4] Balances before mint:")
print(f"  token0: {b0_before/1e18:.4f}")
print(f"  token1: {b1_before/1e18:.4f}")

# ── Step 5: submit mint transaction ───────────────────────────────────────
print("\n[5] Submitting mint transaction...")
try:
    h, r = send(nfs.functions.unlock(OPERATOR, data), gas=1_200_000)
    print(f"  tx     : {h}")
    print(f"  status : {'SUCCESS' if r['status'] == 1 else 'REVERTED'}")
    print(f"  gas    : {r['gasUsed']}")
    assert r['status'] == 1, "Mint transaction reverted!"
except Exception as e:
    print(f"  ERROR: {e}")
    sys.exit(1)

# ── Step 6: check balances after ──────────────────────────────────────────
b0_after = tk0.functions.balanceOf(PROVIDER).call()
b1_after = tk1.functions.balanceOf(PROVIDER).call()
d0 = (b0_before - b0_after) / 1e18
d1 = (b1_before - b1_after) / 1e18
print(f"\n[6] Balances after mint:")
print(f"  token0: {b0_after/1e18:.4f}  (deposited {d0:.6f})")
print(f"  token1: {b1_after/1e18:.4f}  (deposited {d1:.6f})")

if d0 > 0 or d1 > 0:
    print("\n  Liquidity successfully added to the pool!")
    print("  Swaps should now work in the frontend.")
else:
    print("\n  WARNING: No tokens were deposited. Check pool parameters.")

print("\n" + "=" * 60)
print("[add_liquidity] DONE")
print("=" * 60)

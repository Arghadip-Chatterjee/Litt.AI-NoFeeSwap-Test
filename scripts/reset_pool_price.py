"""
scripts/reset_pool_price.py
---------------------------
Swaps token1 -> token0 to push the pool price BACK UP from the
lower boundary to near the midpoint of the [lower, upper] range.

Run from d:\Litt.AI:
  .venv-nofeeswap\Scripts\python.exe scripts\reset_pool_price.py
"""

import sys, os, json, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'contracts', 'operator', 'tests'))
from Nofee import swapSequence   # type: ignore

from web3 import Web3
from eth_account import Account

ROOT = os.path.join(os.path.dirname(__file__), '..', 'deployments.json')
PROVIDER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

with open(ROOT) as f:
    d = json.load(f)

NOFEESWAP = Web3.to_checksum_address(d['contracts']['nofeeswap'])
OPERATOR  = Web3.to_checksum_address(d['contracts']['operator'])
TOKEN0    = Web3.to_checksum_address(d['contracts']['token0'])
TOKEN1    = Web3.to_checksum_address(d['contracts']['token1'])
POOL_ID   = int(d['pool']['poolId'], 16)
LOWER     = d['pool']['lowerTick']
UPPER     = d['pool']['upperTick']
X63       = 1 << 63

w3  = Web3(Web3.HTTPProvider('http://127.0.0.1:8545'))
acc = Account.from_key(PROVIDER_KEY)
PROVIDER = acc.address

ERC20_ABI = [
    {"name": "approve",    "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name":"s","type":"address"},{"name":"v","type":"uint256"}],
     "outputs": [{"type":"bool"}]},
    {"name": "allowance",  "type": "function", "stateMutability": "view",
     "inputs": [{"name":"o","type":"address"},{"name":"s","type":"address"}],
     "outputs": [{"type":"uint256"}]},
    {"name": "balanceOf",  "type": "function", "stateMutability": "view",
     "inputs": [{"name":"a","type":"address"}], "outputs": [{"type":"uint256"}]},
]
NFS_ABI = [
    {"name": "unlock", "type": "function", "stateMutability": "payable",
     "inputs": [{"name":"t","type":"address"},{"name":"d","type":"bytes"}],
     "outputs": []},
    {"name": "isOperator", "type": "function", "stateMutability": "view",
     "inputs": [{"name":"owner","type":"address"},{"name":"op","type":"address"}],
     "outputs": [{"type":"bool"}]},
    {"name": "setOperator", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name":"op","type":"address"},{"name":"approved","type":"bool"}],
     "outputs": []},
]

nfs = w3.eth.contract(address=NOFEESWAP, abi=NFS_ABI)
tk1 = w3.eth.contract(address=TOKEN1,    abi=ERC20_ABI)
tk0 = w3.eth.contract(address=TOKEN0,    abi=ERC20_ABI)

def send(fn, gas=800_000):
    nonce  = w3.eth.get_transaction_count(PROVIDER)
    tx     = fn.build_transaction({'from':PROVIDER,'nonce':nonce,'gas':gas,'gasPrice':w3.to_wei('2','gwei')})
    signed = w3.eth.account.sign_transaction(tx, PROVIDER_KEY)
    raw    = signed.raw_transaction if hasattr(signed, 'raw_transaction') else signed.rawTransaction
    h      = w3.eth.send_raw_transaction(raw)
    w3.provider.make_request("evm_mine", [])
    receipt = w3.eth.wait_for_transaction_receipt(h, timeout=15)
    return h.hex(), receipt

print("=" * 60)
print("[reset_pool_price] Restoring price to midpoint...")
print("=" * 60)
print(f"  Provider  : {PROVIDER}")
print(f"  lowerTick : {LOWER}  upperTick : {UPPER}")

# Ensure operator auth
if not nfs.functions.isOperator(PROVIDER, OPERATOR).call():
    print("  setting operator...")
    send(nfs.functions.setOperator(OPERATOR, True))

# Approve token1 (we're spending token1 to buy token0)
alw = tk1.functions.allowance(PROVIDER, OPERATOR).call()
if alw < 10**24:
    h, r = send(tk1.functions.approve(OPERATOR, 2**256 - 1))
    print(f"  token1 approve: {h}  status={r['status']}")

# Balances before
b0 = tk0.functions.balanceOf(PROVIDER).call()
b1 = tk1.functions.balanceOf(PROVIDER).call()
print(f"\n  Before: token0={b0/1e18:.4f}  token1={b1/1e18:.4f}")

class FakeContract:
    def __init__(self, addr): self.address = addr

# Swap token1 -> token0 (oneForZero = price going UP)
# Limit = just-below upper tick (un-offsetted) = upperTick - X63 - 1
LIMIT    = UPPER - 1 - X63           # allow price to reach upper boundary
AMOUNT   = -(10**18)                  # exact input 1 token1
DEADLINE = int(time.time()) + 300

data = swapSequence(
    FakeContract(NOFEESWAP),
    FakeContract(TOKEN0),
    FakeContract(TOKEN1),
    FakeContract(PROVIDER),
    POOL_ID,
    AMOUNT,
    LIMIT,
    2,            # auto-detect direction
    b'',
    DEADLINE,
)
print(f"\n  Submitting oneForZero swap  (token1->token0)...")
print(f"  amount=-1 token1, limit={LIMIT}, zeroForOne=2")
h, r = send(nfs.functions.unlock(OPERATOR, data), gas=1_000_000)
print(f"  tx    : {h}")
print(f"  status: {'SUCCESS' if r['status'] == 1 else 'REVERTED'}")
print(f"  gas   : {r['gasUsed']}")

b0a = tk0.functions.balanceOf(PROVIDER).call()
b1a = tk1.functions.balanceOf(PROVIDER).call()
print(f"\n  After:  token0={b0a/1e18:.4f}  token1={b1a/1e18:.4f}")
d0  = (b0a - b0) / 1e18
d1  = (b1a - b1) / 1e18
print(f"  Delta:  token0={d0:+.6f}  token1={d1:+.6f}")

if r['status'] == 1 and (b0a != b0 or b1a != b1):
    print("\n  Price reset successful! Pool is back in-range.")
    print("  Now swaps in BOTH directions should work from the UI.")
else:
    print("\n  WARNING: no balance change. Pool might still be at boundary.")
    print("  Try running add_liquidity.py with larger shares first.")

print("=" * 60)

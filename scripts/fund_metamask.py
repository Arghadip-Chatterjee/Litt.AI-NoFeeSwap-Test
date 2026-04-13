"""
Fund the MetaMask wallet with test tokens from Hardhat account[1]
Can be run from ANY directory — path is resolved automatically.
"""
from web3 import Web3
import json, os

w3 = Web3(Web3.HTTPProvider('http://127.0.0.1:8545'))

# Resolve deployments.json — try project root first, then contracts/core
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
ROOT         = os.path.join(SCRIPT_DIR, '..')
DEPLOY_FILE  = os.path.join(ROOT, 'deployments.json')
if not os.path.exists(DEPLOY_FILE):
    DEPLOY_FILE = os.path.join(ROOT, 'contracts', 'core', 'deployments.json')
print(f'[fund_metamask] Using: {os.path.abspath(DEPLOY_FILE)}')

with open(DEPLOY_FILE) as f:
    d = json.load(f)

token0  = w3.to_checksum_address(d['contracts']['token0'])
token1  = w3.to_checksum_address(d['contracts']['token1'])
operator = w3.to_checksum_address(d['contracts']['operator'])

# Hardhat account[1] – has all the tokens
funded     = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
funded_key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

# Target MetaMask wallet
metamask = w3.to_checksum_address('0x4970531D3aC65FDeE903622c51BaE003226cad6F')

ERC20_ABI = [
    {
        "name": "transfer",
        "type": "function",
        "inputs": [{"name": "to", "type": "address"}, {"name": "amount", "type": "uint256"}],
        "outputs": [{"type": "bool"}],
        "stateMutability": "nonpayable"
    },
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view"
    },
]

tk0 = w3.eth.contract(address=token0, abi=ERC20_ABI)
tk1 = w3.eth.contract(address=token1, abi=ERC20_ABI)

nonce = w3.eth.get_transaction_count(funded)
AMOUNT = 10**21  # 1000 tokens (18 decimals)

def send_tx(contract, fn_name, args, nonce):
    fn = getattr(contract.functions, fn_name)
    tx = fn(*args).build_transaction({
        'from': funded,
        'nonce': nonce,
        'gas': 100_000,
        'gasPrice': w3.to_wei(2, 'gwei'),
    })
    signed = w3.eth.account.sign_transaction(tx, funded_key)
    h = w3.eth.send_raw_transaction(signed.rawTransaction)
    w3.provider.make_request('evm_mine', [])
    print(f'  tx: {h.hex()}')
    return nonce + 1

print('[fund_metamask] Transferring 1000 token0 (mUSDC) to MetaMask wallet...')
nonce = send_tx(tk0, 'transfer', [metamask, AMOUNT], nonce)

print('[fund_metamask] Transferring 1000 token1 (mWETH) to MetaMask wallet...')
nonce = send_tx(tk1, 'transfer', [metamask, AMOUNT], nonce)

bal0 = tk0.functions.balanceOf(metamask).call()
bal1 = tk1.functions.balanceOf(metamask).call()
print(f'[fund_metamask] MetaMask token0 balance: {bal0 / 10**18:.4f} mUSDC')
print(f'[fund_metamask] MetaMask token1 balance: {bal1 / 10**18:.4f} mWETH')
print('[fund_metamask] Done! You can now swap in the frontend.')
print('[fund_metamask] The frontend will show an Approve button first — sign it, then Swap.')

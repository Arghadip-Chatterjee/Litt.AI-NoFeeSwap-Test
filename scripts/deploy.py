"""
NoFeeSwap Deployment Script
Deploys: DeployerHelper, NofeeswapDelegatee, Nofeeswap, Operator, 2x ERC20, Pool
Saves addresses to deployments.json
"""

import json
import sys
import os

# Add both repos to path so Brownie can find their contracts
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'contracts', 'core', 'tests'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'contracts', 'operator', 'tests'))

from brownie import (
    accounts,
    Nofeeswap,
    NofeeswapDelegatee,
    ERC20FixedSupply,
    MockHook,
    Operator,
    Deployer,
    network,
    project,
    config,
)
from eth_abi import encode
from sympy import Integer, floor, log

# ─── helpers ────────────────────────────────────────────────────────────────

def to_int(address: str) -> int:
    return int(address, 16)

def twos_complement_int8(n: int) -> int:
    if n < 0:
        return 256 + n
    return n

def get_pool_id(owner_address: str, unsalted_pool_id: int) -> int:
    """
    Compute poolId using abi.encodePacked (tight-packed, not ABI-padded).
    Per YP eq. 55: poolId = unsaltedPoolId + (keccak256(abi.encodePacked(msg.sender, unsaltedPoolId)) << 188)
    """
    from eth_hash.auto import keccak
    # abi.encodePacked: address = 20 bytes, uint256 = 32 bytes (tight, no padding)
    addr_bytes = bytes.fromhex(owner_address.replace('0x', '').zfill(40))
    id_bytes   = unsalted_pool_id.to_bytes(32, 'big')
    data       = addr_bytes + id_bytes
    salt_hash  = int(keccak(data).hex(), 16)
    return (unsalted_pool_id + (salt_hash << 188)) % (2**256)

def encode_kernel_compact(kernel: list) -> list:
    """
    Pack kernel breakpoints as a CONTINUOUS BIT STREAM per YP Figure 22.
    
    Each breakpoint = 80 bits: [16-bit k(q) in X15] || [64-bit q in X59]
    Breakpoints are concatenated MSB-first into a single stream, then
    left-aligned (padded with zeros at LSB) and split into uint256 words.
    Breakpoints CAN span across uint256 word boundaries.
    
    The origin (0,0) is ALWAYS OMITTED from input (YP Remark 37).
    kernel: list of [bX59, cX15] pairs — do NOT include (0,0).
    
    Example (Figure 22, 4 breakpoints = 320 bits → 2 words):
      Slot 1: BP1||BP2||BP3||k(q3)  (256 bits, fully packed)
      Slot 2: q3||zeros             (64 bits + 192 zero-padding)
    """
    if not kernel:
        return []

    # Step 1: Build continuous bit stream
    stream = 0
    total_bits = 0
    for bX59, cX15 in kernel:
        bp = (cX15 << 64) | bX59  # 80-bit breakpoint
        stream = (stream << 80) | bp
        total_bits += 80

    # Step 2: Left-align — pad to next multiple of 256
    remainder = total_bits % 256
    if remainder != 0:
        padding = 256 - remainder
        stream <<= padding
        total_bits += padding

    # Step 3: Split into 256-bit words (MSB word first)
    mask_256 = (1 << 256) - 1
    num_words = total_bits // 256
    words = []
    for i in range(num_words - 1, -1, -1):
        words.append((stream >> (i * 256)) & mask_256)

    return words

def encode_curve(curve: list) -> list:
    return curve

# ─── main ────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("NoFeeSwap Deployment Script")
    print("=" * 60)

    # Use first Hardhat account as root/deployer
    root = accounts[0]
    owner = accounts[1]
    print(f"Root:  {root.address}")
    print(f"Owner: {owner.address}")

    # ── 1. Deploy DeployerHelper (uses Deployer from operator, DeployerHelper from core)
    print("\n[1/8] Deploying Deployer contract...")
    deployer = Deployer.deploy(root, {'from': root})
    print(f"  Deployer: {deployer.address}")

    # Pre-compute addresses with salt 1 (delegatee) and 2 (nofeeswap)
    delegatee_addr = deployer.addressOf(1)
    nofeeswap_addr = deployer.addressOf(2)
    print(f"  Pre-computed Delegatee: {delegatee_addr}")
    print(f"  Pre-computed Nofeeswap: {nofeeswap_addr}")

    # ── 2 & 3. Deploy NofeeswapDelegatee then Nofeeswap (order matters — circular ref)
    print("\n[2/8] Deploying NofeeswapDelegatee via create3...")
    deployer.create3(
        1,
        NofeeswapDelegatee.bytecode + encode(
            ['address'],
            [nofeeswap_addr]
        ).hex(),
        {'from': root}
    )

    print("[3/8] Deploying Nofeeswap via create3...")
    deployer.create3(
        2,
        Nofeeswap.bytecode + encode(
            ['address', 'address'],
            [delegatee_addr, root.address]
        ).hex(),
        {'from': root}
    )

    delegatee = NofeeswapDelegatee.at(delegatee_addr)
    nofeeswap = Nofeeswap.at(nofeeswap_addr)
    print(f"  NofeeswapDelegatee: {delegatee.address}")
    print(f"  Nofeeswap:          {nofeeswap.address}")

    # ── 4. Set protocol parameters (poolGrowthPortion, protocolGrowthPortion, treasury)
    print("\n[4/8] Configuring protocol parameters...")
    pool_growth_portion = (1 << 47) // 5       # 20%
    protocol_growth_portion = 0                 # 0% protocol fee

    nofeeswap.dispatch(
        delegatee.modifyProtocol.encode_input(
            (pool_growth_portion << 208) + (protocol_growth_portion << 160) + int(root.address, 16)
        ),
        {'from': root}
    )
    print(f"  poolGrowthPortion:     {pool_growth_portion}")
    print(f"  protocolGrowthPortion: {protocol_growth_portion}")

    # ── 5. Deploy Operator
    print("\n[5/8] Deploying Operator contract...")
    address0 = '0x' + '0' * 40
    operator = Operator.deploy(nofeeswap, address0, address0, address0, {'from': root})
    print(f"  Operator: {operator.address}")

    # Register operator
    nofeeswap.setOperator(operator, True, {'from': root})
    print("  Operator registered on Nofeeswap ✓")

    # ── 6. Deploy mock ERC-20 tokens
    print("\n[6/8] Deploying mock ERC-20 tokens...")
    token_a = ERC20FixedSupply.deploy("MockUSDC", "mUSDC", 2**128, owner, {'from': owner})
    token_b = ERC20FixedSupply.deploy("MockWETH", "mWETH", 2**128, owner, {'from': owner})

    # Sort tokens (NoFeeSwap requires tag0 < tag1)
    if to_int(token_a.address) > to_int(token_b.address):
        token_a, token_b = token_b, token_a

    token0 = token_a
    token1 = token_b
    tag0 = to_int(token0.address)
    tag1 = to_int(token1.address)

    print(f"  Token0 (mUSDC or mWETH): {token0.address}")
    print(f"  Token1 (mWETH or mUSDC): {token1.address}")
    print(f"  Balance owner token0: {token0.balanceOf(owner)} (2^128)")
    print(f"  Balance owner token1: {token1.balanceOf(owner)} (2^128)")

    # Approve operator to spend tokens
    token0.approve(operator, 2**128, {'from': owner})
    token1.approve(operator, 2**128, {'from': owner})
    print("  Approvals set ✓")

    # ── 7. Initialize a pool
    print("\n[7/8] Initializing pool...")

    # Simple linear kernel (1% price range)
    log_price_tick_x59 = 57643193118714
    fee_spacing_large_x59 = 5793624167011548   # 1.0% fee kernel spacing
    log_price_spacing_large_x59 = 200 * log_price_tick_x59

    # Per YP Remark 37: the origin (0, 0) is ALWAYS the implicit first breakpoint
    # and must NOT be included in the input array.
    # kernel entry format: [bX59 (64-bit log-price position), cX15 (16-bit height)]
    kernel = [
        [log_price_spacing_large_x59, 2**15]   # Linear rise: (0,0) implicit, then (spacing, 1.0)
    ]
    spacing = kernel[-1][0]
    log_offset = 0

    # Set initial price: approximately 1 USDC per WETH (log price ≈ 0)
    from sympy import Integer as SI, floor as sfloor, log as slog
    sqrt_price_x96 = 79228162514264337593543950336  # 1:1 ratio (2^96)
    log_price = int(sfloor((2**60) * slog(sqrt_price_x96 / SI(2**96))))
    log_price_offsetted = log_price - log_offset + (1 << 63)

    lower = log_price - (log_price % spacing) - log_offset + (1 << 63)
    upper = lower + spacing
    curve = [lower, upper, log_price_offsetted]

    # Build unsalted pool id (index=1, logOffset=0, no hook flags, no hook address)
    unsalted_pool_id = (1 << 188) + (twos_complement_int8(log_offset) << 180) + 0
    pool_id = get_pool_id(owner.address, unsalted_pool_id)

    tx = nofeeswap.dispatch(
        delegatee.initialize.encode_input(
            unsalted_pool_id,
            tag0,
            tag1,
            pool_growth_portion,
            encode_kernel_compact(kernel),
            encode_curve(curve),
            b""   # no hook data
        ),
        {'from': owner}
    )
    print(f"  Pool initialized! poolId: {hex(pool_id)}")
    print(f"  tx: {tx.txid}")

    # ── 8. Save deployment addresses
    print("\n[8/8] Saving deployment addresses...")
    deployments = {
        "network": network.show_active(),
        "chainId": 31337,
        "rpcUrl": "http://127.0.0.1:8545",
        "contracts": {
            "nofeeswap":          nofeeswap.address,
            "nofeeswapDelegatee": delegatee.address,
            "operator":           operator.address,
            "token0":             token0.address,
            "token1":             token1.address,
            "token0Symbol":       token0.symbol(),
            "token1Symbol":       token1.symbol(),
        },
        "pool": {
            "poolId":          hex(pool_id),
            "unsaltedPoolId":  hex(unsalted_pool_id),
            "tag0":            hex(tag0),
            "tag1":            hex(tag1),
            "logOffset":       log_offset,
            "initialLogPrice": log_price,
            "sqrtPriceX96":    str(sqrt_price_x96),
            "lowerTick":       lower,
            "upperTick":       upper,
        },
        "testWallet": {
            "address":         owner.address,
            "privateKey":      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",  # hardhat account[1]
        }
    }

    out_path = os.path.join(os.path.dirname(__file__), '..', 'deployments.json')
    with open(out_path, 'w') as f:
        json.dump(deployments, f, indent=2)

    print(f"  Saved to deployments.json ✓")
    print("\n" + "=" * 60)
    print("✅ Deployment complete!")
    print("=" * 60)
    for k, v in deployments['contracts'].items():
        print(f"  {k:25s}: {v}")
    print(f"\n  Pool ID: {deployments['pool']['poolId']}")


if __name__ == "__main__":
    main()

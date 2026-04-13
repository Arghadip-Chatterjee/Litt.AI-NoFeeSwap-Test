"use strict";
/**
 * bot/src/decoder.ts
 * Decodes NoFeeSwap swap transactions from the mempool.
 *
 * Actual TX format (VM bytecode — NOT ABI-encoded):
 *   nofeeswap.unlock(operator, data)
 *   where data = [uint32 deadline] [VM opcodes...]
 *
 * The VM bytecode is parsed to extract the SWAP opcode payload:
 *   SWAP opcode (0x34) followed by:
 *     [uint256 poolId][uint8 amountSpecifiedSlot][uint64 limitOffsetted]
 *     [uint8 zeroForOne][uint8 crossThresholdSlot][uint8 successSlot]
 *     [uint8 amount0Slot][uint8 amount1Slot][uint16 hookDataLen][bytes...]
 *
 * The amountSpecified is loaded from the PUSH32 opcode at the start.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeSwapTx = decodeSwapTx;
const ethers_1 = require("ethers");
const contracts_1 = require("./contracts");
// ── VM Opcodes ────────────────────────────────────────────────────────────
const PUSH32 = 3; // push 32-byte value to a slot
const SWAP_OP = 52; // execute a pool swap
// ── ABI for unlock() outer call ────────────────────────────────────────────
const UNLOCK_ABI = ['function unlock(address operator, bytes calldata data)'];
const unlockInterface = new ethers_1.ethers.Interface(UNLOCK_ABI);
const NOFEESWAP_ADDR = contracts_1.ADDRESSES.nofeeswap?.toLowerCase();
const OPERATOR_ADDR = contracts_1.ADDRESSES.operator?.toLowerCase();
// ── VM bytecode parser ─────────────────────────────────────────────────────
/**
 * Parse the VM bytecode payload (after the uint32 deadline prefix) to extract
 * the SWAP opcode arguments and the PUSH32-stored amountSpecified.
 */
function parseVmBytecode(data) {
    // Minimum viable size: 4 (deadline) + 34 (PUSH32 op) + 44 (SWAP op header)
    if (data.length < 82)
        return null;
    let ptr = 4; // skip uint32 deadline
    let amountSpecified = null;
    let swapFound = false;
    let poolId = 0n;
    let limitOffsetted = 0n;
    let zeroForOne = 0n;
    // Max 1000-byte scan
    const end = Math.min(data.length, 1000);
    while (ptr < end) {
        const opcode = data[ptr];
        if (opcode === PUSH32) {
            // Format: [uint8 PUSH32][int256 value 32 bytes][uint8 destSlot]
            if (ptr + 34 > end)
                break;
            const raw = data.slice(ptr + 1, ptr + 33);
            // int256 big-endian: sign-extend if top bit set
            let val = 0n;
            for (let i = 0; i < 32; i++)
                val = (val << 8n) | BigInt(raw[i]);
            // Two's complement: if bit 255 set, subtract 2^256
            if (val >= (1n << 255n))
                val -= (1n << 256n);
            amountSpecified = val;
            ptr += 34; // opcode + 32 bytes value + 1 byte slot
            continue;
        }
        if (opcode === SWAP_OP) {
            // Format: [uint8 SWAP][uint256 poolId 32b][uint8 amSlot][uint64 limitOff 8b]
            //         [uint8 dir][uint8 crossSlot][uint8 succSlot]
            //         [uint8 am0Slot][uint8 am1Slot][uint16 hookLen 2b][hookData ...]
            const needed = 1 + 32 + 1 + 8 + 1 + 1 + 1 + 1 + 1 + 2; // = 49 bytes
            if (ptr + needed > end)
                break;
            let p = ptr + 1;
            // poolId: 32 bytes big-endian
            let pid = 0n;
            for (let i = 0; i < 32; i++)
                pid = (pid << 8n) | BigInt(data[p + i]);
            p += 32;
            poolId = pid;
            // amountSpecifiedSlot: 1 byte (skip)
            p += 1;
            // limitOffsetted: 8 bytes big-endian
            let lim = 0n;
            for (let i = 0; i < 8; i++)
                lim = (lim << 8n) | BigInt(data[p + i]);
            p += 8;
            limitOffsetted = lim;
            // zeroForOne: 1 byte
            zeroForOne = BigInt(data[p]);
            p += 1;
            swapFound = true;
            break;
        }
        // Skip unknown opcodes — conservatively advance 1 byte
        // (This is a best-effort parser; can skip non-PUSH32/SWAP opcodes)
        ptr += 1;
    }
    if (!swapFound || amountSpecified === null)
        return null;
    return { amountSpecified, poolId, limitOffsetted, zeroForOne };
}
// ── Main decoder ──────────────────────────────────────────────────────────
function decodeSwapTx(tx) {
    if (!tx.data || tx.data.length < 10)
        return null;
    // Must target the Nofeeswap contract
    if (tx.to?.toLowerCase() !== NOFEESWAP_ADDR)
        return null;
    // Decode outer unlock() call
    let unlockDecoded;
    try {
        unlockDecoded = unlockInterface.decodeFunctionData('unlock', tx.data);
    }
    catch {
        return null;
    }
    const [operator, innerData] = unlockDecoded;
    // Must route through the known operator
    if (typeof operator !== 'string' ||
        operator.toLowerCase() !== OPERATOR_ADDR)
        return null;
    // innerData is VM bytecode — parse it
    const rawBytes = ethers_1.ethers.getBytes(innerData);
    const parsed = parseVmBytecode(rawBytes);
    if (!parsed)
        return null;
    const { amountSpecified, poolId, limitOffsetted, zeroForOne } = parsed;
    // Convert limitOffsetted → un-offsetted log price
    // limit = limitOffsetted - 2^63  (logOffset assumed 0 for now)
    const X63 = 1n << 63n;
    const logPriceLimit = limitOffsetted - X63;
    // Direction string
    const directionStr = zeroForOne === 1n ? `${contracts_1.ADDRESSES.token0Symbol ?? 'TK0'}→${contracts_1.ADDRESSES.token1Symbol ?? 'TK1'}` :
        zeroForOne === 0n ? `${contracts_1.ADDRESSES.token1Symbol ?? 'TK1'}→${contracts_1.ADDRESSES.token0Symbol ?? 'TK0'}` :
            'Auto (2)';
    // Approximate slippage from how far the limit is from the current price midpoint
    // In X59 log-price space, the pool's range spans ~logSpacing = upper - lower (un-offsetted)
    const absLimit = logPriceLimit < 0n ? -logPriceLimit : logPriceLimit;
    // Rough: slippage ≈ (distanceInLog / 2^59) * 100
    const logDelta = Number(absLimit) / Math.pow(2, 59);
    const slippagePct = Math.min(99, logDelta * 100);
    return {
        txHash: tx.hash,
        txFrom: tx.from,
        txGasPrice: BigInt(tx.gasPrice?.toString() ?? '1000000000'),
        txNonce: tx.nonce,
        poolId,
        amountSpecified,
        limitOffsetted,
        logPriceLimit,
        zeroForOne,
        slippagePct,
        directionStr,
    };
}

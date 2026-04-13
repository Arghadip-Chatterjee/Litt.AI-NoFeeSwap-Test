"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const mempool_1 = require("./mempool");
const decoder_1 = require("./decoder");
const simulator_1 = require("./simulator");
const attacker_1 = require("./attacker");
const contracts_1 = require("./contracts");
// ── Config ────────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const WS_URL = process.env.WS_URL ?? 'ws://127.0.0.1:8545';
// Hardhat account[2] private key (not account[0] or account[1] used in deployment)
const PRIVATE_KEY = process.env.BOT_PRIVATE_KEY
    ?? '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
// ── Banner ────────────────────────────────────────────────────────────────
function printBanner() {
    console.log(`
╔══════════════════════════════════════════════════════╗
║       NoFeeSwap Sandwich Bot  v1.0.0                 ║
║       Target: ${contracts_1.ADDRESSES.nofeeswap.slice(0, 16)}…          ║
║       Pool:   ${(contracts_1.ADDRESSES.poolId ?? '?').slice(0, 16)}…          ║
╚══════════════════════════════════════════════════════╝
`);
}
// ── Statistics ────────────────────────────────────────────────────────────
const stats = {
    txSeen: 0,
    swapsSeen: 0,
    sandwichAttempts: 0,
    successes: 0,
    totalProfit: 0n,
};
function printStats() {
    console.log(`\n[stats] ─────────────────────────────────────────`);
    console.log(`  Transactions seen:      ${stats.txSeen}`);
    console.log(`  Swap txs detected:      ${stats.swapsSeen}`);
    console.log(`  Sandwich attempts:      ${stats.sandwichAttempts}`);
    console.log(`  Successful sandwiches:  ${stats.successes}`);
    console.log(`  Total profit (est.):    ${ethers_1.ethers.formatEther(stats.totalProfit)} ETH`);
    console.log(`─────────────────────────────────────────────────\n`);
}
// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
    printBanner();
    if (!contracts_1.ADDRESSES.nofeeswap || contracts_1.ADDRESSES.nofeeswap === '0x0000000000000000000000000000000000000000') {
        console.error('❌ ERROR: deployments.json not found or empty.');
        console.error('   Run: d:\\Litt.AI\\.venv-nofeeswap\\Scripts\\brownie run scripts/deploy.py --network hardhat');
        console.error('   from d:\\Litt.AI\\contracts\\core first.');
        process.exit(1);
    }
    // ── Setup providers ────────────────────────────────────────────────────
    const httpProvider = new ethers_1.ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers_1.ethers.Wallet(PRIVATE_KEY, httpProvider);
    const chainId = (await httpProvider.getNetwork()).chainId;
    console.log(`[bot] Connected to chain ${chainId}`);
    console.log(`[bot] Bot wallet: ${wallet.address}`);
    const balance = await httpProvider.getBalance(wallet.address);
    console.log(`[bot] ETH balance: ${ethers_1.ethers.formatEther(balance)} ETH`);
    // ── Setup attacker ─────────────────────────────────────────────────────
    const attacker = new attacker_1.SandwichAttacker(wallet, httpProvider);
    // ── Gas price baseline ─────────────────────────────────────────────────
    const feeData = await httpProvider.getFeeData();
    const baseGasPrice = feeData.gasPrice ?? ethers_1.ethers.parseUnits('1', 'gwei');
    console.log(`[bot] Base gas price: ${ethers_1.ethers.formatUnits(baseGasPrice, 'gwei')} gwei\n`);
    // ── Start mempool monitor ──────────────────────────────────────────────
    const monitor = new mempool_1.MempoolMonitor(WS_URL, async (tx) => {
        stats.txSeen++;
        // Decode: is this a NoFeeSwap swap?
        const decoded = (0, decoder_1.decodeSwapTx)(tx);
        if (!decoded)
            return;
        stats.swapsSeen++;
        console.log(`\n[bot] 🎯 Swap detected! tx: ${tx.hash.slice(0, 14)}…`);
        console.log(`  Pool:            ${decoded.poolId.toString(16).slice(0, 16)}…`);
        console.log(`  AmountSpecified: ${decoded.amountSpecified}`);
        console.log(`  ZeroForOne:      ${decoded.zeroForOne}`);
        console.log(`  From:            ${decoded.txFrom}`);
        console.log(`  Gas Price:       ${ethers_1.ethers.formatUnits(decoded.txGasPrice, 'gwei')} gwei`);
        // Simulate profitability
        const walletBalance = await httpProvider.getBalance(wallet.address);
        const analysis = await (0, simulator_1.analyzeSandwich)(httpProvider, decoded, walletBalance, baseGasPrice);
        console.log(`  📊 Analysis: ${analysis.profitable ? '✅ PROFITABLE' : '❌ Not profitable'}`);
        console.log(`  Reasoning: ${analysis.reasoning}`);
        if (!analysis.profitable)
            return;
        // Execute sandwich
        stats.sandwichAttempts++;
        console.log(`\n[bot] ⚔️  Executing sandwich attack…`);
        console.log(`  Front-run size:  ${ethers_1.ethers.formatEther(analysis.frontrunAmount)} tokens`);
        console.log(`  Front-run gas:   ${ethers_1.ethers.formatUnits(analysis.frontrunGasPrice, 'gwei')} gwei`);
        console.log(`  Back-run gas:    ${ethers_1.ethers.formatUnits(analysis.backrunGasPrice, 'gwei')} gwei`);
        const result = await attacker.executeSandwich(decoded, analysis);
        if (result.success) {
            stats.successes++;
            stats.totalProfit += result.actualProfit ?? 0n;
            console.log(`\n[bot] 💰 Sandwich SUCCESS!`);
            console.log(`  Front-run: ${result.frontrunHash?.slice(0, 18)}…`);
            console.log(`  Back-run:  ${result.backrunHash?.slice(0, 18)}…`);
            console.log(`  Profit:    ${ethers_1.ethers.formatEther(result.actualProfit ?? 0n)} ETH`);
        }
        else {
            console.log(`\n[bot] ❌ Sandwich FAILED: ${result.error}`);
        }
        printStats();
    });
    await monitor.start();
    // Print stats every 30s
    setInterval(printStats, 30000);
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

"use strict";
/**
 * bot/src/simulator.ts
 * Sandwich profitability analysis.
 *
 * For a sandwich on NoFeeSwap:
 *   - Front-run: buy (push price up, cost = frontrunAmount)
 *   - Victim:    buys at worse price (pays slippage)
 *   - Back-run:  sell (recover at higher price, receive = frontrunAmount + profit)
 *
 * Sandwich profit ≈ victimImpact - gas_cost
 *   where victimImpact = slippagePct * amountIn (max the victim could lose)
 *
 * The bot only attacks if estimated profit > MIN_PROFIT_ETH.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeSandwich = analyzeSandwich;
const ethers_1 = require("ethers");
// ── Config ─────────────────────────────────────────────────────────────────
const MIN_PROFIT_ETH = 0.0001; // Minimum profit threshold (ETH)
const GAS_PER_TX = 180000n; // Approx gas per swap tx
const GWEI = 1000000000n;
// ── Math helpers ───────────────────────────────────────────────────────────
/** Estimate liquidity from available balance (rough proxy) */
function estimateLiquidity(walletBalance) {
    // We assume pool liquidity = 1000x our wallet balance (conservative)
    return walletBalance * 1000n;
}
/** Front-run size = 10% of victim's amount (conservative) */
function getFrontrunAmount(amountSpecified) {
    const amt = amountSpecified < 0n ? -amountSpecified : amountSpecified;
    return amt / 10n;
}
/**
 * Estimate gross sandwich profit:
 *   price_impact = amountIn / liquidity
 *   profit ≈ frontrunAmount * price_impact_from_victim
 */
function estimateSandwichProfit(frontrunAmount, victimAmount, liquidity, slippagePct) {
    if (liquidity === 0n)
        return 0n;
    // Victim's price impact in basis points (×10000)
    const victimImpactBps = (victimAmount * 10000n) / liquidity;
    // Our profit ≈ frontrunAmount * (slippagePct% of price impact)
    // We capture a fraction of the victim's slippage
    const profitFraction = BigInt(Math.floor(slippagePct * 100));
    const grossProfit = (frontrunAmount * victimImpactBps * profitFraction) / (10000n * 10000n);
    return grossProfit;
}
/** Gas cost for front-run + back-run at given gas price */
function gasCost(gasPrice) {
    return GAS_PER_TX * 2n * gasPrice;
}
// ── Main analysis ──────────────────────────────────────────────────────────
async function analyzeSandwich(provider, victim, walletBalance, baseGasPrice) {
    // Skip tiny trades
    const absAmount = victim.amountSpecified < 0n ? -victim.amountSpecified : victim.amountSpecified;
    if (absAmount < ethers_1.ethers.parseEther('0.001')) {
        return {
            profitable: false,
            reasoning: `Trade too small (${ethers_1.ethers.formatEther(absAmount)} ETH equivalent)`,
            frontrunAmount: 0n,
            frontrunGasPrice: 0n,
            backrunGasPrice: 0n,
            estimatedProfit: 0n,
        };
    }
    // Skip if slippage is very low (bot will push price beyond limit)
    if (victim.slippagePct < 0.01) {
        return {
            profitable: false,
            reasoning: `Slippage too tight (${victim.slippagePct.toFixed(4)}%) — front-run would revert victim`,
            frontrunAmount: 0n,
            frontrunGasPrice: 0n,
            backrunGasPrice: 0n,
            estimatedProfit: 0n,
        };
    }
    const liquidity = estimateLiquidity(walletBalance);
    const frontrunAmount = getFrontrunAmount(absAmount);
    const grossProfit = estimateSandwichProfit(frontrunAmount, absAmount, liquidity, victim.slippagePct);
    // Gas prices: front-run must be HIGHER than victim, back-run LOWER
    const frontrunGasPrice = victim.txGasPrice + 2n * GWEI;
    const backrunGasPrice = victim.txGasPrice - 1n * GWEI;
    const cost = gasCost(frontrunGasPrice);
    const netProfit = grossProfit - cost;
    const netProfitEth = Number(netProfit) / 1e18;
    if (netProfit <= 0n || netProfitEth < MIN_PROFIT_ETH) {
        return {
            profitable: false,
            reasoning: `Not profitable: gross=${ethers_1.ethers.formatEther(grossProfit)}, gas=${ethers_1.ethers.formatEther(cost)}, net=${netProfitEth.toFixed(6)} ETH`,
            frontrunAmount,
            frontrunGasPrice,
            backrunGasPrice,
            estimatedProfit: netProfit,
        };
    }
    return {
        profitable: true,
        reasoning: `Profitable! net=${netProfitEth.toFixed(6)} ETH, slippage=${victim.slippagePct.toFixed(2)}%, frontrun=${ethers_1.ethers.formatEther(frontrunAmount)} tokens`,
        frontrunAmount,
        frontrunGasPrice,
        backrunGasPrice,
        estimatedProfit: netProfit,
    };
}

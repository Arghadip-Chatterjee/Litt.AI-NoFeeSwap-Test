/**
 * Root hardhat.config.js
 * Used by: npx hardhat node (from d:\Litt.AI)
 *
 * IMPORTANT: mining.auto = false keeps transactions in the pending pool so
 * the sandwich bot can detect them before inclusion in a block.
 * The bot controls mining via: evm_setAutomine(true/false) + evm_mine().
 *
 * For normal development (no bot), run with:
 *   npx hardhat node --config hardhat.config.js
 * For bot testing (automine off by default):
 *   npx hardhat node --config hardhat.config.js
 */
module.exports = {
  networks: {
    hardhat: {
      hardfork: "cancun",
      initialBaseFeePerGas: 0,
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
      // ─── Critical for sandwich bot ───────────────────────────────────────
      // Transactions stay in the mempool until explicitly mined.
      // The bot uses evm_mine() to control block ordering.
      // interval:2000 lets approve/setOperator txs confirm automatically
      // without blocking the sandwich bot (bot disables automine itself).
      mining: {
        auto: false,
        interval: 2000,
      },
      accounts: {
        count: 10,
        accountsBalance: "10000000000000000000000", // 10,000 ETH each
      },
    },
  },
};

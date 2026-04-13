# NoFeeSwap DEX — Full-Stack Engineering Assignment

> **Submission for Senior Full-Stack Engineer Role**
> Covers: Local protocol deployment · Next.js dApp · Mempool sandwich bot

---

## 📋 Table of Contents

1. [Transparency Statement — What Is Complete](#-transparency-statement--what-is-complete)
2. [Prerequisites](#-prerequisites)
3. [Step-by-Step Setup](#-step-by-step-setup)
4. [Project Structure](#-project-structure)
5. [Architecture Overview](#-architecture-overview)
6. [Bot Design — Mempool Decoding & Sandwich Math](#-bot-design--mempool-decoding--sandwich-math)
7. [NoFeeSwap Protocol Math](#-nofeeswap-protocol-math)
8. [Known Limitations](#-known-limitations)
9. [References](#-references)

---

## ✅ Transparency Statement — What Is Complete

> This section is the required explicit statement of completion status. Every feature is listed with its honest status.

### Task 1 — Protocol Deployment

| Step | Status | Detail |
|------|--------|--------|
| Hardhat local blockchain | ✅ Complete | `hardhat.config.js` at root, `cancun` hardfork, `mining.auto=false` |
| `NofeeswapDelegatee` deployment | ✅ Complete | Via `create3` (salt=1), pre-computed address |
| `Nofeeswap` deployment | ✅ Complete | Via `create3` (salt=2), circular reference resolved at deploy time |
| Protocol parameters (`modifyProtocol`) | ✅ Complete | `poolGrowthPortion=20%`, `protocolGrowthPortion=0%` |
| `Operator` deployment + registration | ✅ Complete | `setOperator(operator, True)` on Nofeeswap |
| Mock ERC-20 tokens (×2) | ✅ Complete | `mWETH` + `mUSDC`, `2^128` supply minted to test wallet |
| Tokens sorted by address | ✅ Complete | `tag0 < tag1` enforced (YP Remark 27) |
| Token approvals set | ✅ Complete | Operator pre-approved for `2^128` on both tokens |
| Pool initialization | ✅ Complete | Linear kernel (1 breakpoint), 1:1 price, `dispatch(delegatee.initialize.encode_input(...))` |
| Kernel compact encoding | ✅ Complete | Continuous 80-bit bit-stream per YP Figure 22, origin implicit per Remark 37 |
| Pool ID derivation | ✅ Complete | `keccak256(abi.encodePacked(msg.sender, unsaltedPoolId)) << 188` (YP eq. 55) |
| `deployments.json` | ✅ Complete | All addresses, pool params, test wallet saved |

### Task 2 — dApp Front-End

| Feature | Status | Detail |
|---------|--------|--------|
| MetaMask wallet connection (RainbowKit) | ✅ Complete | Auto-connects to chain 31337 |
| Tx feedback: pending / confirmed / reverted | ✅ Complete | `useTxManager` hook + `TxStatusBanner` |
| Hydration-safe rendering | ✅ Complete | `mounted` guard on all pages prevents SSR↔client mismatches |
| **Initialize Pool page** | ✅ Complete | All 7 params per `INofeeswapDelegatee.sol#L11` |
| Graphical kernel editor (SVG drag) | ✅ Complete | Draggable breakpoints, 4 presets (Linear/Concentrated/Step/Bimodal) |
| Kernel → `kernelCompactArray` encoding | ✅ Complete | Continuous 80-bit bit-stream, YP Figure 22 compliant |
| Curve encoding (`curveArray`) | ✅ Complete | 4 × 64-bit X59 offset-binary per `uint256` slot, YP Table 1 |
| `unsaltedPoolId` bit layout | ✅ Complete | `[index<<188] | [logOffset<<180] | [flags<<160] | hookAddr` (YP Figure 13) |
| **Swap page** | ✅ Complete | `unlock(operator, swapCalldata)` via wagmi |
| Slippage UI (presets + slider) | ✅ Complete | 0.1 / 0.5 / 1.0 / 3.0% presets + continuous range (0.01–50%) |
| `logPriceLimit` slippage enforcement | ✅ Complete | Two's complement X59 (YP Table 2), sent to contract |
| Estimated output display | ✅ Complete | `amountIn × (1 − slippage%)` at 1:1 init price |
| Price impact badge (colour-coded) | ✅ Complete | Green < 0.1% / Amber < 1% / Red ≥ 1% |
| 3-step swap flow | ✅ Complete | Enable Operator → Approve Token → Swap |
| VM bytecode calldata builder | ✅ Complete | `buildSwapCalldata()` in `nofee.ts` — direct port of `Nofee.py::swapSequence()` |
| **Liquidity page** | ✅ Complete | SVG tick range selector, Add & Remove tabs |
| `buildMintCalldata` | ✅ Complete | Direct port of `Nofee.py::mintSequence()` |
| `buildBurnCalldata` | ✅ Complete | Direct port of `Nofee.py::burnSequence()` |
| Live on-chain position balance read | ⚠️ Partial | Pool stats shown; user's shares display uses mock value. Real value needs event indexing or `Access._readGrowthMultiplier` |
| Live swap quote (`eth_call` simulation) | 🔲 Omitted | Approximated by formula; exact needs `Access._readDynamicParams` on-chain call |

### Task 3 — Sandwich Bot

| Feature | Status | Detail |
|---------|--------|--------|
| WebSocket mempool subscription | ✅ Complete | `eth_subscribe("newPendingTransactions")` via ethers.js WS provider |
| `mining.auto=false` on node | ✅ Complete | Hardhat config has `mining: { auto: false, interval: 2000 }` |
| Target detection (filter to NoFeeSwap) | ✅ Complete | Filters `tx.to === nofeeswap` and validates `unlock()` selector |
| Calldata decoding — outer `unlock()` | ✅ Complete | `decodeFunctionData('unlock', tx.data)` |
| VM bytecode parsing — `PUSH32` + `SWAP` | ✅ Complete | Linear scan of operator VM bytecode; extracts `poolId`, `amountSpecified`, `limitOffsetted`, `zeroForOne` |
| Slippage extraction from `logPriceLimit` | ✅ Complete | `slippagePct ≈ |limitOffsetted − 2^63| / 2^59 × 100` |
| Trade size extraction | ✅ Complete | `amountSpecified` from `PUSH32` opcode |
| Profitability simulation | ✅ Complete | Price-impact model, gas cost subtraction, `MIN_PROFIT=0.0001 ETH` threshold |
| Front-run tx submission | ✅ Complete | `victimGasPrice + 2 gwei`, explicit nonce |
| Back-run tx submission | ✅ Complete | `victimGasPrice - 1 gwei`, explicit nonce+1 |
| Block ordering via `evm_setAutomine` / `evm_mine` | ✅ Complete | Freeze → submit front + back → mine → unfreeze |
| Dedup & memory-safe seen-set | ✅ Complete | Prunes oldest 1K entries when set exceeds 10K |
| WebSocket auto-reconnect | ✅ Complete | `close` event → 5-second retry |
| Real profit capture with MEV contract | 🔲 Omitted | Requires a `SandwichExecutor.sol`; bot submits EOA txs without atomic capture |

---

## 🧰 Prerequisites

### Required Software

| Tool | Minimum Version | Check Command |
|------|----------------|---------------|
| Node.js | **18.0.0** | `node --version` |
| npm | **9.0.0** | `npm --version` |
| Python | **3.12.x** (exact) | `py -3.12 --version` |
| Git | any | `git --version` |

> ⚠️ **Python 3.12 is required.** `eth-brownie==1.20.7` is incompatible with Python 3.13+. Use `py -3.12` (Windows py launcher) or `python3.12` on Linux/macOS.

> ⚠️ **Windows users**: PowerShell execution policy may block venv activation. Run: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### Key Package Versions (pinned)

| Package | Version | Used in |
|---------|---------|---------|
| `eth-brownie` | 1.20.7 | Python deploy scripts |
| `hardhat` | 2.24.0 | Local blockchain node |
| `next` | 14.2.35 | Frontend framework |
| `wagmi` | 2.12.x | Web3 React hooks |
| `viem` | 2.21.x | Ethereum primitives |
| `@rainbow-me/rainbowkit` | 2.1.x | Wallet connection UI |
| `ethers` | 6.16.x | Bot provider |
| `ts-node` | 10.9.x | Bot runtime |

### Environment Variables

Create `d:\Litt.AI\bot\.env` (`.env.example` is included):

```env
# Bot wallet private key — Hardhat account[2] (dev-only, never use in production)
BOT_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a

# Hardhat node URLs
RPC_URL=http://127.0.0.1:8545
WS_URL=ws://127.0.0.1:8545
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BOT_PRIVATE_KEY` | Optional | `0x5de4111…` (account[2]) | Sandwich bot signing key |
| `RPC_URL` | Optional | `http://127.0.0.1:8545` | Hardhat HTTP endpoint |
| `WS_URL` | Optional | `ws://127.0.0.1:8545` | Hardhat WebSocket endpoint |

**Pre-funded test accounts (Hardhat dev keys — never use on mainnet):**

```
Account[0]  (Deployer)
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Key:     0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

Account[1]  (Pool owner / test wallet — import this into MetaMask)
Address: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Key:     0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

Account[2]  (Sandwich bot wallet)
Address: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
Key:     0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
```

---

## 🚀 Step-by-Step Setup

> Open **4 separate terminals**. Run all commands from `d:\Litt.AI\` unless otherwise stated.

---

### Step 0 — Clone and install (first-time only)

```powershell
# The contracts are already cloned at d:\Litt.AI\contracts\core and contracts\operator.
# If starting from scratch:
git clone https://github.com/NoFeeSwap/core   contracts/core
git clone https://github.com/NoFeeSwap/operator contracts/operator

# Install Hardhat in both contract repos (required for Brownie ABI compilation)
cd d:\Litt.AI\contracts\core
npm install hardhat@2.24.0 --save-dev --legacy-peer-deps

cd d:\Litt.AI\contracts\operator
npm install hardhat@2.24.0 --save-dev --legacy-peer-deps

# Install root hardhat
cd d:\Litt.AI
npm install
```

---

### Step 1 — Python venv + Brownie (one-time setup)

```powershell
cd d:\Litt.AI

# Create venv using Python 3.12
py -3.12 -m venv .venv-nofeeswap

# Activate
.venv-nofeeswap\Scripts\Activate.ps1

# Install all Python dependencies
pip install --upgrade pip
pip install eth-brownie==1.20.7 sympy==1.14.0 safe-pysha3==1.0.3 "eth_hash[pysha3]" eth-abi
```

---

### Step 2 — Terminal 1: Start Hardhat node

> Keep this terminal open throughout the session. Mining is set to `interval=2000ms` (auto-mines every 2s) so normal transactions confirm, but the bot disables automine manually during the sandwich window.

```powershell
cd d:\Litt.AI
npx hardhat node --config hardhat.config.js
```

Expected output:
```
Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/
Account #0: 0xf39Fd6e51... (10000 ETH)
Account #1: 0x70997970... (10000 ETH)
...
```

---

### Step 3 — Terminal 2: Deploy contracts

```powershell
cd d:\Litt.AI\contracts\core
d:\Litt.AI\.venv-nofeeswap\Scripts\Activate.ps1
```

> ⚠️ **One-time Brownie network setup** — Brownie must know how to reach the Hardhat node.
> Skip this if you have run it before (it persists in `~/.brownie/network-config.yaml`).

```powershell
# Register the hardhat network with Brownie (one-time only)
brownie networks add Ethereum hardhat host=http://127.0.0.1:8545 chainid=31337
```

If you see `"hardhat" is already a network`, that's fine — proceed.

```powershell
# Run the deployment script (from contracts/core — the Brownie project root)
brownie run ..\..\scripts\deploy.py --network hardhat
```

Expected output (abridged):
```
==================================================
NoFeeSwap Deployment Script
==================================================
[1/8] Deploying Deployer contract...
[2/8] Deploying NofeeswapDelegatee via create3...
[3/8] Deploying Nofeeswap via create3...
[4/8] Configuring protocol parameters...
[5/8] Deploying Operator contract...
[6/8] Deploying mock ERC-20 tokens...
[7/8] Initializing pool...
[8/8] Saving deployment addresses...
✅ Deployment complete!
```

This writes `d:\Litt.AI\deployments.json` with all contract addresses and pool parameters.

> **Re-deploying**: If you restart Hardhat, re-run this step. The frontend reads `deployments.json` at build time — restart `npm run dev` after re-deploying.

---

### Step 4 — Terminal 3: Start the frontend

```powershell
cd d:\Litt.AI\frontend
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

**Configure MetaMask:**
1. Add Network:
   - Name: `Hardhat Local`
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency Symbol: `ETH`
2. Import Account (pool owner / swap user):
   - Private Key: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`

---

### Step 5 — Terminal 4: Start the sandwich bot

```powershell
cd d:\Litt.AI\bot
npm install
npm start
```

Expected output:
```
╔══════════════════════════════════════════════════════╗
║       NoFeeSwap Sandwich Bot  v1.0.0                 ║
║       Target: 0x6E9e11f0eF58…                       ║
╚══════════════════════════════════════════════════════╝
[bot] Connected to chain 31337
[bot] Bot wallet: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
[bot] 👀 Watching mempool. Press Ctrl+C to stop.
```

---

### Step 6 — Trigger a swap (watch the bot detect it)

From the frontend (`http://localhost:3000/swap`):
1. Connect MetaMask (Account[1])
2. Click **Enable Operator** → sign tx
3. Click **Approve mWETH** → sign tx
4. Enter an amount and click **Swap mWETH → mUSDC**

The bot terminal will print:
```
[bot] 🎯 Swap detected! tx: 0x7a3b...
  Pool:            ddc9fcf715dce89...
  AmountSpecified: -1000000000000000000
  ZeroForOne:      1
  📊 Analysis: ✅ PROFITABLE
[bot] ⚔️  Executing sandwich attack…
[bot] 💰 Sandwich SUCCESS!
```

Or trigger programmatically:
```powershell
cd d:\Litt.AI\contracts\core
d:\Litt.AI\.venv-nofeeswap\Scripts\Activate.ps1
brownie run ..\..\scripts\test_swap.py --network hardhat
```

---

## 🗂️ Project Structure

```
d:\Litt.AI\
├── hardhat.config.js          ← Root node config (cancun hardfork, mining.auto=false)
├── deployments.json           ← Auto-generated by deploy.py (contract addresses + pool params)
├── package.json               ← Root hardhat dependency
│
├── contracts/
│   ├── core/                  ← github.com/NoFeeSwap/core (cloned)
│   │   └── tests/             ← Reference: Initialize_test.py, SwapData_test.py
│   └── operator/              ← github.com/NoFeeSwap/operator (cloned)
│       └── tests/
│           └── Nofee.py       ← VM opcode reference (swapSequence, mintSequence, burnSequence)
│
├── scripts/
│   ├── deploy.py              ← Brownie deployment (replicates Initialize_test.py#L67-78)
│   ├── add_liquidity.py       ← Standalone liquidity seeding script
│   ├── test_swap.py           ← Smoke test swap (triggers the bot)
│   ├── test_proper_swap.py    ← Extended swap test
│   └── fund_metamask.py       ← Fund MetaMask account[1] from account[0]
│
├── frontend/                  ← Next.js 14 + wagmi v2 + RainbowKit
│   ├── app/
│   │   ├── layout.tsx         ← Root layout with wagmi/RainbowKit providers
│   │   ├── page.tsx           ← Dashboard (pool stats, quick links)
│   │   ├── initialize/        ← Pool initialization + graphical kernel editor
│   │   │   └── page.tsx
│   │   ├── swap/              ← Token swap UI
│   │   │   └── page.tsx
│   │   ├── liquidity/         ← Add/remove liquidity
│   │   │   └── page.tsx
│   │   ├── pool/              ← Pool explorer
│   │   │   └── page.tsx
│   │   └── components/
│   │       ├── KernelEditor.tsx   ← SVG graphical kernel editor
│   │       └── TxStatusBanner.tsx ← Transaction state feedback
│   └── lib/
│       ├── contracts.ts       ← ABIs + addresses (reads deployments.json)
│       ├── kernel.ts          ← X59 math, kernel encoding, curve builder (YP-aligned)
│       ├── nofee.ts           ← VM bytecode calldata builders (port of Nofee.py)
│       └── hooks/
│           └── useTxManager.ts ← Tx lifecycle state machine (idle→signing→pending→confirmed/reverted)
│
└── bot/
    ├── .env.example           ← Copy to .env and fill in
    └── src/
        ├── index.ts           ← Entry point, stats tracker, orchestration loop
        ├── mempool.ts         ← WebSocket mempool subscription + reconnect
        ├── decoder.ts         ← unlock() calldata decoder + VM bytecode parser
        ├── simulator.ts       ← Sandwich profitability math
        ├── attacker.ts        ← Front-run / back-run / evm_mine orchestration
        └── contracts.ts       ← Addresses + ABIs loaded from deployments.json
```

---

## 🏛️ Architecture Overview

### Transaction Flow (Swap)

```
User (MetaMask)
      │
      ▼  nofeeswap.unlock(operator, swapCalldata)
      │    └─ swapCalldata = packed VM bytecode:
      │         [uint32 deadline]
      │         [PUSH32 amountSpecified → slot15]
      │         [SWAP poolId, slot15, limitOffsetted, zeroForOne, ...]
      │         [JUMP if success]
      │         [token0 branch: LT → NEG+TAKE or SYNC+TRANSFER+SETTLE]
      │         [token1 branch: same pattern]
      ▼
Nofeeswap.unlock() calls back → operator.unlockCallback(data)
      │
      ▼  Operator VM executes opcodes sequentially
      │    SWAP opcode → nofeeswap.swap(poolId, amount, limit, direction)
      │    TAKE_TOKEN → nofeeswap.take(token, recipient, amount)      [user receives]
      │    SYNC_TOKEN + TRANSFER_FROM_PAYER + SETTLE                  [user pays]
      ▼
Delta accounting clears, tx finalizes
```

### Kernel Editor → On-Chain Flow

```
User drags SVG breakpoints in KernelEditor
        │
        ▼  KernelPointUI[] { xFrac, yFrac }
        │
        ▼  uiPointsToKernelPoints(uiPoints, LOG_PRICE_SPACING_X59)
        │    bX59 = round(xFrac × qSpacing)   [64-bit log-price, X59]
        │    cX15 = round(yFrac × 2^15)       [16-bit height, X15]
        │
        ▼  encodeKernelCompact(kernelPoints)
        │    For each breakpoint: pack 80-bit = (cX15 << 64) | bX59
        │    Concatenate into one continuous bit stream, MSB-first
        │    Left-align to next multiple of 256 bits
        │    Split into uint256[] array
        │    (Breakpoints CAN span word boundaries — YP Figure 22)
        │
        ▼  nofeeswap.dispatch(
             delegatee.initialize.encode_input(
               unsaltedPoolId, tag0, tag1,
               poolGrowthPortion,
               kernelCompactArray,   ← from above
               curveArray,           ← [lower, upper, current] in X59 offset-binary
               hookData='0x'
             )
           )
```

### Bot Architecture

```
                    ┌─────────────────────────────────────┐
                    │         Hardhat Node :8545          │
                    │   mempool: pending txs              │
                    └────────────┬────────────────────────┘
                                 │  WebSocket
                    ┌────────────▼────────────────────────┐
                    │       MempoolMonitor                │
                    │  eth_subscribe("newPendingTxns")    │
                    │  dedup seen-set, auto-reconnect     │
                    └────────────┬────────────────────────┘
                                 │  tx hash → full tx object
                    ┌────────────▼────────────────────────┐
                    │         decodeSwapTx()              │
                    │  Filter: tx.to === nofeeswap?       │
                    │  Decode: unlock(operator, data)     │
                    │  Parse VM: PUSH32 → amountSpecified │
                    │            SWAP → poolId, limit,    │
                    │                   zeroForOne        │
                    │  Compute: slippagePct from limit    │
                    └────────────┬────────────────────────┘
                                 │  DecodedSwap
                    ┌────────────▼────────────────────────┐
                    │        analyzeSandwich()            │
                    │  frontrunAmt = victimAmt / 10       │
                    │  liquidity   = botBalance × 1000    │
                    │  grossProfit = frontrunAmt ×        │
                    │    (victimAmt/liquidity) × slippage │
                    │  gasCost = 2 × 180k gas × gasPrice  │
                    │  profitable = net > 0.0001 ETH      │
                    └────────────┬────────────────────────┘
                                 │  SandwichAnalysis
                    ┌────────────▼────────────────────────┐
                    │      SandwichAttacker               │
                    │  1. evm_setAutomine(false)          │
                    │  2. Submit front-run @ gas+2gwei    │
                    │  3. Submit back-run  @ gas-1gwei    │
                    │  4. evm_mine()  → ordered block:    │
                    │     [front-run] [victim] [back-run] │
                    │  5. evm_setAutomine(true)           │
                    └─────────────────────────────────────┘
```

---

## 🤖 Bot Design — Mempool Decoding & Sandwich Math

### Calldata Decoding (Two-Level)

NoFeeSwap swaps are not simple ABI-encoded function calls. They use a **custom stack-based VM**:

```
tx.data
  └─ Level 1 (ABI): nofeeswap.unlock(address operator, bytes data)
                                                           │
  └─ Level 2 (VM bytecode scan):                          │
       data = [uint32 deadline] [VM opcodes...]           │
                                                          ▼
       Scan for opcode 3  (PUSH32): reads 32-byte int256 → amountSpecified
       Scan for opcode 52 (SWAP):
         [uint8 SWAP][uint256 poolId 32B][uint8 amSlot]
         [uint64 limitOffsetted 8B][uint8 zeroForOne]
         [uint8 crossSlot][uint8 succSlot][uint8 am0Slot][uint8 am1Slot]
         [uint16 hookLen][hookData...]
```

**Slippage extraction:**
```
limitOffsetted  = raw 64-bit value from SWAP opcode
logPriceLimit   = limitOffsetted - 2^63          (un-offset)
absLogLimit     = |logPriceLimit|
slippagePct     ≈ (absLogLimit / 2^59) × 100     (approximate, in %)
```

### Profitability Model

```
Given:
  victimAmount  = |amountSpecified|
  slippagePct   = inferred from logPriceLimit
  walletBalance = bot's ETH balance

Derived:
  liquidity       = walletBalance × 1000           (proxy for pool depth)
  frontrunAmount  = victimAmount / 10              (10% of victim size)

Price impact (victim's):
  victimImpactBps = (victimAmount × 10000) / liquidity

Gross profit:
  grossProfit = frontrunAmount × victimImpactBps × floor(slippagePct×100)
                / (10000 × 10000)

Gas cost (2 txs):
  gasCost = 2 × 180,000 gas × frontrunGasPrice

Net profit:
  netProfit = grossProfit - gasCost

Execute only if: netProfit > 0.0001 ETH AND slippagePct ≥ 0.01%
```

### Block Ordering Guarantee

With `mining.auto=false` and `interval=2000ms` set in Hardhat config:

- Regular txs (approve, setOperator) still auto-mine every 2 seconds
- Bot **disables** automine (`evm_setAutomine(false)`) during the sandwich window
- After submitting front-run and back-run, bot calls `evm_mine()` once
- Hardhat mines txs in gas-price descending order within a block:
  ```
  front-run (victimGas+2gwei) → victim (victimGas) → back-run (victimGas-1gwei)
  ```
- Bot immediately re-enables automine (`evm_setAutomine(true)`)

---

## 🔢 NoFeeSwap Protocol Math

> All formulas below are derived from the NoFeeSwap Yellow Paper.

### 1. X59 Log Price (Two's Complement, for limits and positions)

```
logPrice_X59 = floor(2^59 × ln(price))
```

Used for: `logPriceLimit` (swap), `qMin`/`qMax` (liquidity positions), kernel breakpoints

**Implementation** (`lib/kernel.ts`):
```typescript
// 1 tick = floor(2^59 × ln(1.0001))
export const LOG_PRICE_TICK_X59 = 57643193118714n;
// 1% spacing = 200 ticks
export const LOG_PRICE_SPACING_X59 = LOG_PRICE_TICK_X59 * 200n;

export function priceToLogPrice(price: number): number {
  return Math.log(price);  // natural log
}
```

### 2. X59 Offset-Binary (for curve sequence members)

Different format used only for curve sequence entries (YP Table 1):

```
curveEntry = floor(2^59 × (16 + ln(price/pOffset)))
           = floor(2^59 × (16 + logPrice))   when logOffset=0

Range: 0 < h < 2^64
  h=0          corresponds to price = e^(-16) × pOffset
  h=2^63       corresponds to price = pOffset  (current zero-log price)
  h=2^64       corresponds to price = e^(16) × pOffset
```

**Implementation** (`lib/kernel.ts`):
```typescript
export function encodePrice(logPrice: number, logOffset: number = 0): bigint {
  const q = logPrice - logOffset;
  return BigInt(Math.floor(Math.pow(2, 59) * (16 + q)));
}
```

### 3. Initial Curve Array (3 entries minimum)

```
curve[0] = encode(lowerQ)    ← left boundary, snapped to spacing
curve[1] = encode(upperQ)    ← right boundary = lowerQ + qSpacing
curve[2] = encode(qCurrent)  ← initial price
```

Where: `lowerQ = floor(qCurrent / qSpacing) × qSpacing`

### 4. Kernel Compact Encoding (YP Remark 36 + Figure 22)

Each breakpoint `i`: `(bX59[i], cX15[i])`:
- `bX59` = horizontal coordinate in X59 (64-bit, range `[0, qSpacing]`)
- `cX15` = vertical coordinate in X15 (16-bit, `2^15 = 100%`)

**80-bit breakpoint**:
```
bp[i] = (cX15[i] << 64) | bX59[i]     ← height first, then position
```

**Continuous bit-stream packing** (breakpoints can span word boundaries):
```
stream = bp[0] || bp[1] || bp[2] || ...    (MSB-first concatenation)
Left-align stream to next multiple of 256 bits (pad with zeros at LSB)
Split into uint256[] array
```

**The origin `(0, 0)` is NEVER included** — it is always the implicit first breakpoint (YP Remark 37).

### 5. Pool ID Derivation (YP Equation 55)

```
poolId = unsaltedPoolId +
         (keccak256(abi.encodePacked(msg.sender, unsaltedPoolId)) << 188)
         mod 2^256
```

Note: `abi.encodePacked` = tight packing (20 bytes address + 32 bytes uint256 = 52 bytes total), **not** ABI-padded 64 bytes.

### 6. unsaltedPoolId Bit Layout (YP Figure 13)

```
Bits 255–188  (68 bits): salt / index — derived from keccak, set by chain
Bits 187–180  (8 bits):  logOffset (int8 two's complement, range -89..+89)
Bits 179–160  (20 bits): hook flags (isPreSwap, isMutableKernel, etc.)
Bits 159–0    (160 bits): hook contract address
```

### 7. Slippage → logPriceLimit (YP Table 2)

```
slippagePct% → |logBound|_X59 = floor(2^59 × |ln(1 - slippagePct/100)|)

zeroForOne swap (price moves down):  logPriceLimit = -logBound
oneForZero swap (price moves up):    logPriceLimit = +logBound
```

On-chain the limit is passed as the `limitOffsetted` field (offset-binary):
```
limitOffsetted = logPriceLimit + 2^63 - logOffset × 2^59
               = logPriceLimit + 2^63    (when logOffset=0)
```

### 8. LP Position Tag (YP Section 3.2.3)

Used to track shares in a position `(poolId, qMin, qMax)`:
```
tagShares = keccak256(abi.encode(poolId, qMin, qMax))
```

Note: `abi.encode` = ABI-padded (3 × 32 = 96 bytes). `qMin` and `qMax` are X59 two's complement (signed int256).

---

## ⚠️ Known Limitations

### Incomplete Features

| Feature | Root Cause | How to Fix |
|---------|-----------|------------|
| **Live on-chain swap quote** | Exact output requires reading `integral0/1`, `growth`, `sharesTotal` from Nofeeswap's transient/dynamic params | Implement `eth_call` to `Access._readDynamicParams(nofeeswap, poolId)` and compute token amounts via YP equations 57a/57b |
| **Live LP position display** | User share balance requires reading `MODIFY_SINGLE_BALANCE` ERC-6909 events or calling `nofeeswap.balanceOf(tagShares)` | Subscribe to `ModifyPosition` events from block 0; accumulate per-address share deltas |
| **Real sandwich profit capture** | Bot submits 3 EOA txs but has no mechanism to atomically pocket the spread | Deploy a `SandwichExecutor.sol` that calls `nofeeswap.unlock()` twice (buy then sell) within one callback, settling net profit |
| **Full pool explorer** | Current tick, TVL, and fee growth need live `eth_call` reads from dynamic params slot | Read slot via `getDynamicParamsSlot(poolId)` and decode the 256-bit packed struct |

### Known Bugs

| Bug | Description | Workaround |
|-----|-------------|------------|
| **`deployments.json` is static** | Frontend imports addresses at Next.js build time; re-deploying contracts silently uses stale addresses | Restart `npm run dev` after every re-deployment |
| **Price impact is approximate** | Impact formula assumes `10,000 token` pool liquidity, not actual on-chain `sharesTotal` | Use live `sharesTotal × growth / outgoingMax` from dynamic params |
| **Bot profit is estimated only** | `actualProfit` returns the same `estimatedProfit` value; real profit needs balance delta measurement pre/post block | Read `token0/token1.balanceOf(bot)` before step 1 and after step 5, compare |
| **`evm_setAutomine` race condition** | If two swaps arrive nearly simultaneously, the second might be mined by the 2s interval before the bot handles the first | Add a global lock / queue in the bot to serialize sandwich attempts |
| **Brownie not in PATH on Windows** | If `brownie` command fails, use the full path: `.venv-nofeeswap\Scripts\brownie.exe` | Add `.venv-nofeeswap\Scripts` to `$env:PATH` or use the full path |

### What I Would Improve with More Time

1. **Real-time price oracle**: Query `Access._readDynamicParams(nofeeswap, poolId)` via `eth_call`, decode `logPriceCurrent`, and display as `exp(h/2^59 − 16) × pOffset`

2. **Event-driven LP position tracker**: Subscribe to `ModifyPosition` + `Swap` events from the contract to build a real-time position ledger without needing an external indexer

3. **Atomic MEV contract**: A `SandwichExecutor.sol` that bundles the front-run and back-run inside a single `unlock()` callback, making the profit capture atomic and eliminating the nonce/gas race condition

4. **Hardhat → Anvil migration**: Anvil has a dedicated `--no-mining` / `--block-time 0` flag and `anvil_setIntervalMining` RPC, which gives cleaner control than toggling Hardhat's interval

5. **Slippage decoder precision**: The current bot uses a linear approximation for `slippagePct` from `logPriceLimit`. A correct implementation would be: `slippagePct = (1 - exp(|logPriceLimit| / 2^59)) × 100`

6. **Multi-hop sandwich detection**: Extend the VM bytecode parser to detect sequences with multiple `SWAP` opcodes (multi-hop routes) and compute the combined price impact

---

## 🔗 References

| Resource | Link |
|----------|------|
| NoFeeSwap Core (contracts) | https://github.com/NoFeeSwap/core |
| NoFeeSwap Operator | https://github.com/NoFeeSwap/operator |
| `Initialize_test.py` — deployment reference | https://github.com/NoFeeSwap/core/blob/main/tests/Initialize_test.py#L67-L78 |
| `SwapData_test.py` — operator VM reference | https://github.com/NoFeeSwap/operator/blob/main/tests/SwapData_test.py |
| `Nofee.py` — VM opcodes & sequences | https://github.com/NoFeeSwap/operator/blob/main/tests/Nofee.py |
| `INofeeswapDelegatee.sol` — initialize interface | https://github.com/NoFeeSwap/core/blob/main/contracts/interfaces/INofeeswapDelegatee.sol |
| NoFeeSwap Yellow Paper | https://github.com/NoFeeSwap/docs |

---

## 📜 License

This submission is for evaluation purposes only.  
NoFeeSwap protocol is Copyright 2025, NoFeeSwap LLC — All rights reserved.

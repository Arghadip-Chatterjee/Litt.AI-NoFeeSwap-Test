"use strict";
/**
 * bot/src/mempool.ts
 * WebSocket subscription to pending transactions via eth_subscribe
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MempoolMonitor = void 0;
const ethers_1 = require("ethers");
class MempoolMonitor {
    constructor(wsUrl, handler) {
        this.provider = null;
        this.wsUrl = wsUrl;
        this.handler = handler;
        this.seen = new Set();
    }
    async start() {
        console.log('[mempool] Starting WebSocket subscription to pending transactions…');
        this.provider = new ethers_1.ethers.WebSocketProvider(this.wsUrl);
        // Subscribe to pending tx hashes
        this.provider.on('pending', async (txHash) => {
            if (this.seen.has(txHash))
                return;
            this.seen.add(txHash);
            // Cleanup old entries to prevent memory leak
            if (this.seen.size > 10000) {
                const iter = this.seen.values();
                for (let i = 0; i < 1000; i++) {
                    const next = iter.next();
                    if (!next.done)
                        this.seen.delete(next.value);
                }
            }
            try {
                const tx = await this.provider.getTransaction(txHash);
                if (tx && tx.to) {
                    await this.handler(tx);
                }
            }
            catch {
                // Tx may have been dropped from pool
            }
        });
        // Handle WebSocket disconnects via close event
        const ws = this.provider.websocket;
        ws.addEventListener('close', () => {
            console.warn('[mempool] WebSocket closed. Reconnecting in 5s…');
            setTimeout(() => this.start(), 5000);
        });
        console.log('[mempool] ✅ Subscribed. Watching for NoFeeSwap swap transactions…');
    }
    async stop() {
        if (this.provider) {
            await this.provider.destroy();
        }
        console.log('[mempool] Stopped.');
    }
}
exports.MempoolMonitor = MempoolMonitor;

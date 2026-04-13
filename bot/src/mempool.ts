/**
 * bot/src/mempool.ts
 * WebSocket subscription to pending transactions via eth_subscribe
 */

import { ethers } from 'ethers';

export type PendingTxHandler = (tx: ethers.TransactionResponse) => Promise<void>;

export class MempoolMonitor {
  private wsUrl:    string;
  private handler:  PendingTxHandler;
  private seen:     Set<string>;
  private provider: ethers.WebSocketProvider | null = null;

  constructor(wsUrl: string, handler: PendingTxHandler) {
    this.wsUrl   = wsUrl;
    this.handler = handler;
    this.seen    = new Set();
  }

  async start(): Promise<void> {
    console.log('[mempool] Starting WebSocket subscription to pending transactions…');

    this.provider = new ethers.WebSocketProvider(this.wsUrl);

    // Subscribe to pending tx hashes
    this.provider.on('pending', async (txHash: string) => {
      if (this.seen.has(txHash)) return;
      this.seen.add(txHash);

      // Cleanup old entries to prevent memory leak
      if (this.seen.size > 10_000) {
        const iter = this.seen.values();
        for (let i = 0; i < 1_000; i++) {
          const next = iter.next();
          if (!next.done) this.seen.delete(next.value as string);
        }
      }

      try {
        const tx = await this.provider!.getTransaction(txHash);
        if (tx && tx.to) {
          await this.handler(tx);
        }
      } catch {
        // Tx may have been dropped from pool
      }
    });

    // Handle WebSocket disconnects via close event
    const ws = this.provider.websocket as WebSocket;
    ws.addEventListener('close', () => {
      console.warn('[mempool] WebSocket closed. Reconnecting in 5s…');
      setTimeout(() => this.start(), 5_000);
    });

    console.log('[mempool] ✅ Subscribed. Watching for NoFeeSwap swap transactions…');
  }

  async stop(): Promise<void> {
    if (this.provider) {
      await this.provider.destroy();
    }
    console.log('[mempool] Stopped.');
  }
}

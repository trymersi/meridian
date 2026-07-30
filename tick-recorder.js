/**
 * PnL tick recorder — append-only sampling of the fast poller.
 *
 * Why: pool-memory snapshots are ~10min apart, far too coarse to reproduce
 * trailing-TP behaviour (peak, then a 2.5% drop) which the 3s poller acts on.
 * Backtesting exit rules needs data at roughly the cadence the rules run at.
 *
 * Writes one compact JSONL line per position per sample to
 * logs/pnl-ticks-YYYY-MM-DD.jsonl. Sampling is throttled per position so the
 * 3s poller doesn't turn into a disk hammer.
 */

import fs from "fs";
import path from "path";
import { repoPath } from "./repo-root.js";

const LOG_DIR = repoPath("logs");
const DEFAULT_SAMPLE_MS = 30_000;

const _lastSampleAt = new Map(); // position -> epoch ms

function filePath() {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `pnl-ticks-${day}.jsonl`);
}

/**
 * Record one poller observation. Cheap and non-throwing — never let telemetry
 * break the exit path.
 *
 * @param {object} p           position object from getMyPositions
 * @param {object} [opts]
 * @param {number} [opts.sampleMs] minimum gap between samples per position
 * @param {string} [opts.signal]   exit signal detected this tick, if any
 * @param {number} [opts.peak]     confirmed peak pnl_pct from state
 */
export function recordTick(p, opts = {}) {
  try {
    if (!p?.position || p.pnl_pct == null) return;
    const sampleMs = Number(opts.sampleMs ?? DEFAULT_SAMPLE_MS);
    const now = Date.now();
    const last = _lastSampleAt.get(p.position) ?? 0;
    // Always record a tick that carries an exit signal — those are the moments
    // a backtest most needs, and they are rare enough not to matter for volume.
    if (!opts.signal && now - last < sampleMs) return;
    _lastSampleAt.set(p.position, now);

    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    const line = JSON.stringify({
      ts: new Date(now).toISOString(),
      pos: p.position,
      pool: p.pool,
      pair: p.pair ?? null,
      pnl: p.pnl_pct,
      pnl_usd: p.pnl_usd ?? null,
      fees: p.unclaimed_fees_usd ?? null,
      in_range: p.in_range ?? null,
      active: p.active_bin ?? null,
      lower: p.lower_bin ?? null,
      upper: p.upper_bin ?? null,
      oor_min: p.minutes_out_of_range ?? null,
      age: p.age_minutes ?? null,
      fee_tvl: p.fee_per_tvl_24h ?? null,
      susp: p.pnl_pct_suspicious ? 1 : 0,
      peak: opts.peak ?? null,
      signal: opts.signal ?? null,
    });
    fs.appendFileSync(filePath(), line + "\n");
  } catch {
    // Telemetry must never interfere with trading.
  }
}

/** Drop in-memory throttle state for a closed position. */
export function forgetTick(position) {
  _lastSampleAt.delete(position);
}

import fs from 'fs';

// ── Deep performance audit ──────────────────────────────────────
// Run on the VPS where the real lessons.json lives:  node audit-deep.js
const data = JSON.parse(fs.readFileSync('lessons.json', 'utf8'));
const perf = (data.performance || []).filter(p => p && p.pnl_pct != null);

const net = p => (p.pnl_usd || 0) + (p.fees_earned_usd || 0);
const isSL = p => /stop.?loss|stop_loss/i.test(p.close_reason || '');
const isTrail = p => /trailing/i.test(p.close_reason || '');
const isOOR = p => /out.?of.?range|oor|pumped.?far/i.test(p.close_reason || '');
const fmt = n => (n >= 0 ? '+' : '') + n.toFixed(2);

const total = perf.length;
const wins = perf.filter(p => net(p) > 0).length;
const netTotal = perf.reduce((s, p) => s + net(p), 0);
const priceTotal = perf.reduce((s, p) => s + (p.pnl_usd || 0), 0);
const feesTotal = perf.reduce((s, p) => s + (p.fees_earned_usd || 0), 0);

console.log('═══════════════ DEEP AUDIT ═══════════════');
console.log(`Trades: ${total} | Win(net): ${wins} (${(wins/total*100).toFixed(1)}%)`);
console.log(`Net: $${fmt(netTotal)}  =  price $${fmt(priceTotal)} + fees $${fmt(feesTotal)}`);
console.log(`Fees are what keeps you alive: without them net would be $${fmt(priceTotal)}`);

// ── 1. Realized-only vs everything ──────────────────────────────
// Fabriq shows unrealized; here everything is realized (closed) so this IS the true P&L.
console.log('\n─── EXPECTANCY ───');
const avgWin = perf.filter(p => net(p) > 0).reduce((s, p) => s + net(p), 0) / (wins || 1);
const losers = perf.filter(p => net(p) <= 0);
const avgLoss = losers.reduce((s, p) => s + net(p), 0) / (losers.length || 1);
const expectancy = netTotal / total;
console.log(`Avg win $${fmt(avgWin)} | Avg loss $${fmt(avgLoss)} | Expectancy $${fmt(expectancy)}/trade`);
console.log(`Reward:risk ratio ${(avgWin / Math.abs(avgLoss || 1)).toFixed(2)} (want > 1.0 at this win rate)`);

// ── 2. By close reason ──────────────────────────────────────────
const reasons = {};
perf.forEach(p => {
  let k = 'Other';
  if (isSL(p)) k = 'Stop Loss';
  else if (isTrail(p)) k = 'Trailing TP';
  else if (/take.?profit/i.test(p.close_reason || '')) k = 'Take Profit';
  else if (/pumped.?far/i.test(p.close_reason || '')) k = 'Pumped Above Range';
  else if (/low.?yield/i.test(p.close_reason || '')) k = 'Low Yield';
  else if (/out.?of.?range|oor/i.test(p.close_reason || '')) k = 'OOR';
  (reasons[k] ??= { n: 0, w: 0, net: 0, min: 0 });
  reasons[k].n++; reasons[k].net += net(p);
  if (net(p) > 0) reasons[k].w++;
  reasons[k].min += p.minutes_held || 0;
});
console.log('\n─── BY CLOSE REASON (sorted by net impact) ───');
Object.entries(reasons).sort((a, b) => a[1].net - b[1].net).forEach(([k, v]) => {
  console.log(`${k.padEnd(20)} ${String(v.n).padStart(3)}x | win ${(v.w/v.n*100).toFixed(0).padStart(3)}% | net $${fmt(v.net).padStart(8)} | avg ${(v.min/v.n).toFixed(0)}m`);
});

// ── 3. Stop loss depth: are we exiting at -4% or slipping past it? ─
const sls = perf.filter(isSL);
if (sls.length) {
  console.log('\n─── STOP LOSS SLIPPAGE ───');
  const depths = sls.map(p => p.pnl_pct).sort((a, b) => a - b);
  const med = depths[Math.floor(depths.length / 2)];
  const worse6 = sls.filter(p => p.pnl_pct <= -6).length;
  const worse8 = sls.filter(p => p.pnl_pct <= -8).length;
  console.log(`Count ${sls.length} | median exit ${med.toFixed(1)}% | worst ${depths[0].toFixed(1)}%`);
  console.log(`Slipped past -6%: ${worse6} (${(worse6/sls.length*100).toFixed(0)}%) | past -8%: ${worse8} (${(worse8/sls.length*100).toFixed(0)}%)`);
  console.log(`→ If most exits are far below threshold, the 10-min cycle is too slow OR threshold too tight.`);
}

// ── 4. Recurring loser tokens/pools (where cooldown matters most) ─
const byPool = {};
perf.forEach(p => {
  const k = p.pool_name || p.pool || '?';
  (byPool[k] ??= { n: 0, net: 0, sl: 0 });
  byPool[k].n++; byPool[k].net += net(p);
  if (isSL(p)) byPool[k].sl++;
});
const repeatLosers = Object.entries(byPool)
  .filter(([, v]) => v.n >= 2 && v.net < 0)
  .sort((a, b) => a[1].net - b[1].net)
  .slice(0, 15);
console.log('\n─── REPEAT-LOSER POOLS (deployed 2+ times, net negative) ───');
repeatLosers.forEach(([k, v]) => {
  console.log(`${String(k).padEnd(22)} ${v.n}x | net $${fmt(v.net).padStart(8)} | ${v.sl} stop-loss`);
});
const repeatLossSum = repeatLosers.reduce((s, [, v]) => s + v.net, 0);
console.log(`These ${repeatLosers.length} pools alone cost $${fmt(repeatLossSum)} — stop-loss cooldown targets exactly this.`);

// ── 5. Recent trend: is performance degrading? ──────────────────
console.log('\n─── TREND (chronological chunks of 100) ───');
for (let i = 0; i < perf.length; i += 100) {
  const chunk = perf.slice(i, i + 100);
  const n = chunk.reduce((s, p) => s + net(p), 0);
  const w = chunk.filter(p => net(p) > 0).length;
  const slN = chunk.filter(isSL).length;
  console.log(`trades ${String(i+1).padStart(3)}-${String(i+chunk.length).padStart(3)}: net $${fmt(n).padStart(8)} | win ${(w/chunk.length*100).toFixed(0)}% | ${slN} SL`);
}

// ── 6. Trailing TP: leaving money on the table? ─────────────────
const trails = perf.filter(isTrail);
if (trails.length) {
  console.log('\n─── TRAILING TP CHECK ───');
  const tnet = trails.reduce((s, p) => s + net(p), 0);
  const avgPct = trails.reduce((s, p) => s + p.pnl_pct, 0) / trails.length;
  const peaks = trails.filter(p => p.peak_pnl_pct != null);
  const givedBack = peaks.length
    ? peaks.reduce((s, p) => s + (p.peak_pnl_pct - p.pnl_pct), 0) / peaks.length
    : null;
  console.log(`Count ${trails.length} | net $${fmt(tnet)} | avg exit ${avgPct.toFixed(2)}%`);
  if (givedBack != null) console.log(`Avg given back from peak: ${givedBack.toFixed(2)}pp (trailingDropPct trade-off)`);
}

// ── 7. Hold-time sweet spot ─────────────────────────────────────
const buckets = { '<30m': [], '30-60m': [], '1-3h': [], '3-8h': [], '>8h': [] };
perf.forEach(p => {
  const m = p.minutes_held || 0;
  const b = m < 30 ? '<30m' : m < 60 ? '30-60m' : m < 180 ? '1-3h' : m < 480 ? '3-8h' : '>8h';
  buckets[b].push(p);
});
console.log('\n─── BY HOLD TIME ───');
Object.entries(buckets).forEach(([b, arr]) => {
  if (!arr.length) return;
  const w = arr.filter(p => net(p) > 0).length;
  const n = arr.reduce((s, p) => s + net(p), 0);
  console.log(`${b.padEnd(8)} ${String(arr.length).padStart(3)}x | win ${(w/arr.length*100).toFixed(0).padStart(3)}% | net $${fmt(n)}`);
});

console.log('\n═══════════════ END ═══════════════');

import fs from 'fs';

// ════════════════════════════════════════════════════════════════════════════
//  Exit-rule backtest — replays exit rules over recorded PnL trajectories.
//
//  DATA SOURCE: pool-memory.json `snapshots[]` — real per-position pnl_pct time
//  series (~10 min cadence, last 48 per pool). pnl_pct already includes fees
//  (see tools/pnl.js deriveOpenPnlPct), so it is the net figure exits act on.
//
//  HONESTY NOTE — CENSORING. Snapshots stop when a position actually closed.
//  So any rule that would have held LONGER than reality has no data past that
//  point. Those cases are reported as CENSORED, never scored as wins. Only
//  trajectories with observations after the decision point are counted as
//  evidence. Read the CENSORED numbers before trusting any delta.
//
//  Run:  node backtest.js
// ════════════════════════════════════════════════════════════════════════════

const pm = JSON.parse(fs.readFileSync('pool-memory.json', 'utf8'));
const perfList = (JSON.parse(fs.readFileSync('lessons.json', 'utf8')).performance || [])
  .filter(p => p && p.pnl_pct != null);

// ── Build trajectories: position -> ordered pnl series ──────────────────────
// Prefer logs/pnl-ticks-*.jsonl (written by tick-recorder.js at ~30s cadence).
// Trailing rules act on peak-then-drop dynamics that 10min snapshots cannot
// resolve, so snapshot-only runs under-report trailing exits badly.
const poolNameByPos = new Map();

function buildMap(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!r.position || !Number.isFinite(r.pnl)) continue;
    if (!m.has(r.position)) m.set(r.position, []);
    m.get(r.position).push(r);
    if (r.name) poolNameByPos.set(r.position, r.name);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.ts - b.ts);
  return m;
}
const usable = m => [...m.values()].filter(a => a.length >= 3).length;

// Source A — tick logs (fine cadence, written by tick-recorder.js).
const tickFiles = fs.existsSync('logs')
  ? fs.readdirSync('logs').filter(f => /^pnl-ticks-.*\.jsonl$/.test(f)).sort()
  : [];
const tickRows = [];
for (const f of tickFiles) {
  for (const line of fs.readFileSync(`logs/${f}`, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let t; try { t = JSON.parse(line); } catch { continue; }
    if (t.susp) continue; // unpriceable tick — live rules pause on these too
    tickRows.push({ position: t.pos, ts: new Date(t.ts).getTime(), pnl: Number(t.pnl), inRange: t.in_range, age: t.age ?? null, name: t.pair });
  }
}

// Source B — pool-memory snapshots (coarse, ~10min).
const snapRows = [];
for (const [poolAddr, entry] of Object.entries(pm)) {
  for (const s of entry.snapshots || []) {
    snapRows.push({ position: s.position, ts: new Date(s.ts).getTime(), pnl: Number(s.pnl_pct), inRange: s.in_range, age: s.age_minutes ?? null, name: entry.name || poolAddr.slice(0, 8) });
  }
}

// Pick whichever source actually yields more usable trajectories — early on the
// tick log is nearly empty, and silently preferring it would hide all the data.
const tickMap = buildMap(tickRows);
const snapMap = buildMap(snapRows);
const useTicks = usable(tickMap) >= usable(snapMap) && usable(tickMap) > 0;
const traj = useTicks ? tickMap : snapMap;
const tickPoints = useTicks ? tickRows.length : 0;
const source = useTicks
  ? `logs/pnl-ticks — ${tickRows.length} ticks, ${usable(tickMap)} usable trajectories (~30s cadence)`
  : `pool-memory snapshots — ${snapRows.length} points, ${usable(snapMap)} usable trajectories (~10min cadence)`
    + (usable(tickMap) > 0 ? ` [tick log present but thinner: ${usable(tickMap)} trajectories]` : '');

// Keep trajectories with enough points to reason about
const series = [...traj.entries()].filter(([, arr]) => arr.length >= 3);

const perfByPos = new Map(perfList.map(p => [p.position, p]));

console.log('═══════════════ EXIT-RULE BACKTEST ═══════════════');
console.log(`Source: ${source}`);
console.log(`Trajectories: ${series.length} positions | data points: ${[...traj.values()].reduce((s, a) => s + a.length, 0)}`);
console.log(`Matched to a closed-trade record: ${series.filter(([p]) => perfByPos.has(p)).length}`);
console.log('pnl_pct is net of fees.');
if (tickPoints === 0) {
  console.log('\n⚠️  No tick logs yet — running on 10min snapshots, which CANNOT reproduce');
  console.log('    trailing-TP behaviour. Sections 2-4 will under-report trailing exits.');
  console.log('    Deploy tick-recorder.js and re-run after a few days for usable numbers.');
}

// ════════════════════════════════════════════════════════════════════════════
//  ANALYSIS 1 — STOP LOSS THRESHOLD: how often is a trigger a FALSE trigger?
//  For each candidate threshold, find the first snapshot at/below it, then look
//  ONLY at later snapshots. If PnL climbs back above the threshold, cutting
//  there was premature. Cases with no later snapshot are censored.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n─── 1. STOP LOSS THRESHOLD (dip → recovery test) ───');
console.log('th      trig  censored  recovered>th  recovered>0   avg best after');
for (const th of [-3, -4, -5, -6, -7, -8, -10]) {
  let trig = 0, censored = 0, recovAbove = 0, recovProfit = 0;
  const bestAfter = [];
  for (const [, arr] of series) {
    const i = arr.findIndex(p => p.pnl <= th);
    if (i === -1) continue;
    trig++;
    const after = arr.slice(i + 1);
    if (after.length === 0) { censored++; continue; }
    const best = Math.max(...after.map(p => p.pnl));
    bestAfter.push(best);
    if (best > th) recovAbove++;
    if (best > 0) recovProfit++;
  }
  const informative = trig - censored;
  const pct = n => informative > 0 ? `${(n / informative * 100).toFixed(0)}%` : '—';
  const avgBest = bestAfter.length ? (bestAfter.reduce((a, b) => a + b, 0) / bestAfter.length).toFixed(1) + '%' : '—';
  console.log(
    `${String(th).padStart(3)}%  ${String(trig).padStart(5)}  ${String(censored).padStart(8)}  ` +
    `${String(recovAbove).padStart(6)} ${pct(recovAbove).padStart(5)}  ` +
    `${String(recovProfit).padStart(6)} ${pct(recovProfit).padStart(5)}  ${avgBest.padStart(10)}`
  );
}
console.log('Read: high "recovered>th" = that threshold cuts positions that would have come back.');

// ════════════════════════════════════════════════════════════════════════════
//  ANALYSIS 2 — TRAILING TP: arm / drop / profit floor
//  Simulates the real rule set from state.js on each trajectory.
// ════════════════════════════════════════════════════════════════════════════
function simulate(arr, cfg) {
  let peak = 0, armed = false;
  for (let i = 0; i < arr.length; i++) {
    const pnl = arr[i].pnl;
    if (pnl > peak) peak = pnl;
    if (cfg.trailingEnabled && !armed && peak >= cfg.trigger) armed = true;

    // Stop loss first — mirrors state.js ordering.
    if (pnl <= cfg.stopLoss) return { exit: 'SL', pnl, i };

    if (cfg.takeProfit != null && pnl >= cfg.takeProfit) return { exit: 'TP', pnl, i };

    if (armed && pnl >= cfg.floor) {
      const tightFrom = cfg.tightFrom ?? Infinity;
      const drop = peak >= tightFrom ? (cfg.tightDrop ?? cfg.drop) : cfg.drop;
      if (peak - pnl >= drop) return { exit: 'TRAIL', pnl, i };
    }
  }
  return { exit: null, pnl: arr[arr.length - 1].pnl, i: arr.length - 1, censored: true };
}

function scoreConfig(cfg) {
  let sum = 0, n = 0, censored = 0;
  const byExit = {};
  for (const [, arr] of series) {
    const r = simulate(arr, cfg);
    if (r.censored) censored++;
    const key = r.exit || 'HELD';
    (byExit[key] ??= { n: 0, sum: 0 });
    byExit[key].n++; byExit[key].sum += r.pnl;
    sum += r.pnl; n++;
  }
  return { avgPnl: n ? sum / n : 0, n, censored, byExit };
}

const BASE = {
  stopLoss: -4, takeProfit: 8, trailingEnabled: true,
  trigger: 3, drop: 2.5, floor: -Infinity, // floor -Inf = current (pre-fix) behaviour
};

console.log('\n─── 2. TRAILING PROFIT FLOOR ───');
console.log('Floor blocks a trailing exit while PnL is below it. -Inf = old behaviour.');
console.log('floor      avg exit PnL   SL   TRAIL   TP   HELD(censored)');
for (const floor of [-Infinity, 0, 0.5, 1, 1.5, 2]) {
  const r = scoreConfig({ ...BASE, floor });
  const g = k => r.byExit[k]?.n ?? 0;
  const label = floor === -Infinity ? '-Inf' : `+${floor}%`;
  console.log(
    `${label.padEnd(9)} ${r.avgPnl.toFixed(2).padStart(9)}%   ` +
    `${String(g('SL')).padStart(3)} ${String(g('TRAIL')).padStart(6)} ${String(g('TP')).padStart(4)}   ${String(g('HELD')).padStart(4)}`
  );
}

// How many trailing exits actually fired UNDERWATER under current settings?
{
  let underwater = 0, atLoss = 0, total = 0;
  const recovered = [];
  for (const [, arr] of series) {
    const r = simulate(arr, BASE);
    if (r.exit !== 'TRAIL') continue;
    total++;
    if (r.pnl < 0.5) underwater++;
    if (r.pnl < 0) atLoss++;
    const after = arr.slice(r.i + 1);
    if (r.pnl < 0.5 && after.length) recovered.push(Math.max(...after.map(p => p.pnl)) - r.pnl);
  }
  console.log(`\nUnder current settings: ${total} trailing exits, ${underwater} below +0.5%, ${atLoss} at an outright loss.`);
  if (recovered.length) {
    const avg = recovered.reduce((a, b) => a + b, 0) / recovered.length;
    console.log(`Of the low exits with later data (${recovered.length}), PnL rose ${avg.toFixed(2)}pp on average afterwards.`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  ANALYSIS 3 — TIGHT TRAIL (Charon's idea: narrow the trail after a big peak)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n─── 3. TIGHT TRAIL (narrow drop once peak clears a bar) ───');
console.log('tightFrom  tightDrop   avg exit PnL   vs base');
const baseScore = scoreConfig({ ...BASE, floor: 1.5 }).avgPnl;
console.log(`(base: floor +1.5%, fixed drop ${BASE.drop}% → ${baseScore.toFixed(2)}%)`);
for (const tightFrom of [5, 8, 12]) {
  for (const tightDrop of [1, 1.5, 2]) {
    const r = scoreConfig({ ...BASE, floor: 1.5, tightFrom, tightDrop });
    const d = r.avgPnl - baseScore;
    console.log(
      `${String(tightFrom).padStart(6)}%  ${String(tightDrop).padStart(7)}%   ` +
      `${r.avgPnl.toFixed(2).padStart(9)}%   ${(d >= 0 ? '+' : '') + d.toFixed(2)}pp`
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  ANALYSIS 4 — GRID: stop loss × floor
// ════════════════════════════════════════════════════════════════════════════
console.log('\n─── 4. GRID: stopLoss × trailingProfitFloor (avg exit PnL) ───');
const floors = [-Infinity, 0.5, 1.5, 2];
console.log('SL\\floor ' + floors.map(f => (f === -Infinity ? '-Inf' : `+${f}%`).padStart(9)).join(''));
for (const sl of [-4, -5, -6, -8]) {
  const row = floors.map(floor => scoreConfig({ ...BASE, stopLoss: sl, floor }).avgPnl.toFixed(2).padStart(8) + '%');
  console.log(`${String(sl).padStart(3)}%    ` + row.join(''));
}

// ════════════════════════════════════════════════════════════════════════════
//  CAVEATS
// ════════════════════════════════════════════════════════════════════════════
const censoredBase = scoreConfig(BASE).censored;
console.log('\n─── CAVEATS (read before acting) ───');
console.log(`• ${censoredBase}/${series.length} trajectories never trigger an exit in-window (censored).`);
console.log('• Snapshots end at the real close, so rules that hold LONGER than reality are');
console.log('  unobservable past that point — widening the stop loss is systematically censored.');
console.log('• Cadence is ~10min; the live poller runs every 3s, so it catches dips this misses.');
console.log('• Analysis 1 (dip → recovery) is the least censored and most trustworthy signal here.');
console.log('\n═══════════════ END ═══════════════');

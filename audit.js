import fs from 'fs';
const data = JSON.parse(fs.readFileSync('lessons.json', 'utf8'));
const perf = data.performance || [];

const total = perf.length;
const wins = perf.filter(p => (p.pnl_pct || 0) > 0).length;
const losses = perf.filter(p => (p.pnl_pct || 0) <= 0).length;
const avgPnl = perf.reduce((s, p) => s + (p.pnl_pct || 0), 0) / total;
const avgWin = perf.filter(p => p.pnl_pct > 0).reduce((s, p) => s + p.pnl_pct, 0) / wins;
const avgLoss = perf.filter(p => p.pnl_pct <= 0).reduce((s, p) => s + p.pnl_pct, 0) / losses;
const totalPnlUsd = perf.reduce((s, p) => s + (p.pnl_usd || 0), 0);
const totalFees = perf.reduce((s, p) => s + (p.fees_earned_usd || 0), 0);

console.log('=== ENTRY AUDIT ===');
console.log(`Total: ${total} | Wins: ${wins} | Losses: ${losses} | Win rate: ${(wins/total*100).toFixed(1)}%`);
console.log(`Avg PnL: ${avgPnl.toFixed(2)}% | Avg win: +${avgWin.toFixed(2)}% | Avg loss: ${avgLoss.toFixed(2)}%`);
console.log(`Total PnL: $${totalPnlUsd.toFixed(2)} | Total fees: $${totalFees.toFixed(2)}`);
console.log(`Net total: $${(totalPnlUsd + totalFees).toFixed(2)}`);

// By close reason (grouped)
const byReason = {};
perf.forEach(p => {
  const r = p.close_reason || 'unknown';
  let key = r;
  if (/stop.?loss|stop_loss/i.test(r)) key = 'Stop Loss';
  else if (/trailing.?tp|trailing_tp/i.test(r)) key = 'Trailing TP';
  else if (/take.?profit/i.test(r)) key = 'Take Profit';
  else if (/pumped.?far|rule.?3|oor:.?pumped/i.test(r)) key = 'Pumped Above Range';
  else if (/low.?yield|low_yield/i.test(r)) key = 'Low Yield';
  else if (/out.?of.?range|oor/i.test(r)) key = 'OOR';

  if (!byReason[key]) byReason[key] = { count: 0, wins: 0, pnl: 0, fees: 0, minutes: 0 };
  byReason[key].count++;
  if ((p.pnl_pct || 0) > 0) byReason[key].wins++;
  byReason[key].pnl += (p.pnl_usd || 0);
  byReason[key].fees += (p.fees_earned_usd || 0);
  byReason[key].minutes += (p.minutes_held || 0);
});

console.log('\n=== BY CLOSE REASON ===');
Object.entries(byReason).sort((a, b) => b[1].count - a[1].count).forEach(([r, v]) => {
  const wr = (v.wins / v.count * 100).toFixed(0);
  const net = (v.pnl + v.fees).toFixed(2);
  const avgMin = (v.minutes / v.count).toFixed(0);
  console.log(`${r}: ${v.count}x | win ${wr}% | net $${net} | avg hold ${avgMin}m`);
});

// By hold time
const buckets = { '<30m': [], '30-60m': [], '1-3h': [], '3-8h': [], '>8h': [] };
perf.forEach(p => {
  const m = p.minutes_held || 0;
  if (m < 30) buckets['<30m'].push(p);
  else if (m < 60) buckets['30-60m'].push(p);
  else if (m < 180) buckets['1-3h'].push(p);
  else if (m < 480) buckets['3-8h'].push(p);
  else buckets['>8h'].push(p);
});

console.log('\n=== BY HOLD TIME ===');
Object.entries(buckets).forEach(([b, arr]) => {
  if (!arr.length) return;
  const w = arr.filter(p => p.pnl_pct > 0).length;
  const net = arr.reduce((s, p) => s + (p.pnl_usd || 0) + (p.fees_earned_usd || 0), 0);
  console.log(`${b}: ${arr.length}x | win ${(w / arr.length * 100).toFixed(0)}% | net $${net.toFixed(2)}`);
});

// Stop loss detail
const stopLosses = perf.filter(p => /stop.?loss|stop_loss/i.test(p.close_reason || ''));
if (stopLosses.length) {
  console.log('\n=== STOP LOSS DETAIL ===');
  console.log(`Total: ${stopLosses.length}`);
  const slPnl = stopLosses.reduce((s, p) => s + (p.pnl_usd || 0), 0);
  const slFees = stopLosses.reduce((s, p) => s + (p.fees_earned_usd || 0), 0);
  console.log(`Price PnL: $${slPnl.toFixed(2)} | Fees: $${slFees.toFixed(2)} | Net: $${(slPnl + slFees).toFixed(2)}`);
  console.log(`Avg hold: ${(stopLosses.reduce((s, p) => s + (p.minutes_held || 0), 0) / stopLosses.length).toFixed(0)}m`);
  stopLosses.slice(-10).forEach(p => {
    const net = (p.pnl_usd || 0) + (p.fees_earned_usd || 0);
    console.log(`  ${(p.pool_name || '?').padEnd(20)} ${p.pnl_pct.toFixed(2)}% | fees $${(p.fees_earned_usd||0).toFixed(2)} | net $${net.toFixed(2)} | ${p.minutes_held || 0}m`);
  });
}

// Last 20 trades
console.log('\n=== LAST 20 TRADES ===');
perf.slice(-20).forEach(p => {
  const net = (p.pnl_usd || 0) + (p.fees_earned_usd || 0);
  const netSign = net >= 0 ? '+' : '';
  const pnlSign = p.pnl_pct >= 0 ? '+' : '';
  console.log(
    `${(p.pool_name || '?').padEnd(18)} ${pnlSign}${p.pnl_pct.toFixed(2)}% | net ${netSign}$${net.toFixed(2)} | ${(p.close_reason || '').substring(0, 50)}`
  );
});

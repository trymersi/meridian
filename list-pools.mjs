/**
 * list-pools.mjs — simulasi persis filter yang dipakai bot
 * Usage: node list-pools.mjs [limit]
 * Example: node list-pools.mjs 30
 */

import { readFileSync } from "fs";

const limit = parseInt(process.argv[2] || "20");

let cfg;
try {
  cfg = JSON.parse(readFileSync("./user-config.json", "utf8"));
} catch {
  console.error("user-config.json tidak ditemukan");
  process.exit(1);
}

const s = cfg;

// Filter persis sama dengan yang dipakai bot di screening.js
const botFilters = [
  "base_token_has_critical_warnings=false",
  "quote_token_has_critical_warnings=false",
  "pool_type=dlmm",
  `base_token_market_cap>=${s.minMcap}`,
  `base_token_market_cap<=${s.maxMcap}`,
  `base_token_holders>=${s.minHolders}`,
  `volume>=${s.minVolume}`,
  `tvl>=${s.minTvl}`,
  s.maxTvl != null ? `tvl<=${s.maxTvl}` : null,
  `dlmm_bin_step>=${s.minBinStep}`,
  `dlmm_bin_step<=${s.maxBinStep}`,
  `fee_active_tvl_ratio>=${s.minFeeActiveTvlRatio}`,
  `base_token_organic_score>=${s.minOrganic}`,
  `quote_token_organic_score>=${s.minQuoteOrganic}`,
  s.minTokenAgeHours != null
    ? `base_token_created_at<=${Date.now() - s.minTokenAgeHours * 3_600_000}`
    : null,
].filter(Boolean).join("&&");

// Juga coba tanpa filter organic untuk perbandingan
const noOrganicFilters = [
  "base_token_has_critical_warnings=false",
  "quote_token_has_critical_warnings=false",
  "pool_type=dlmm",
  `base_token_market_cap>=${s.minMcap}`,
  `base_token_market_cap<=${s.maxMcap}`,
  `base_token_holders>=${s.minHolders}`,
  `volume>=${s.minVolume}`,
  `tvl>=${s.minTvl}`,
  s.maxTvl != null ? `tvl<=${s.maxTvl}` : null,
  `dlmm_bin_step>=${s.minBinStep}`,
  `dlmm_bin_step<=${s.maxBinStep}`,
  `fee_active_tvl_ratio>=${s.minFeeActiveTvlRatio}`,
].filter(Boolean).join("&&");

const BASE = "https://pool-discovery-api.datapi.meteora.ag/pools";

async function fetchPools(filters) {
  const url = `${BASE}?page_size=${limit}&filter_by=${encodeURIComponent(filters)}&timeframe=${s.timeframe}&category=${s.category}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.data || [];
}

const pad = (str, len) => String(str ?? "").slice(0, len).padEnd(len);
const fmt = (n, dec = 2) => Number(n || 0).toFixed(dec);

function printPools(pools) {
  console.log(
    pad("PAIR", 22) +
    pad("TVL", 11) +
    pad("VOL", 11) +
    pad("fee/TVL%", 10) +
    pad("HOLDERS", 9) +
    pad("MCAP", 13) +
    pad("VOL(30m)", 10) +
    "POOL_ADDRESS"
  );
  console.log("─".repeat(120));
  for (const p of pools) {
    const pair = `${p.token_x?.symbol || p.base_token_symbol || "?"}-${p.token_y?.symbol || "SOL"}`;
    const tvl   = `$${Number(p.active_tvl || p.tvl || 0).toLocaleString("en", { maximumFractionDigits: 0 })}`;
    const vol   = `$${Number(p.volume || 0).toLocaleString("en", { maximumFractionDigits: 0 })}`;
    const feeTvl = `${fmt(p.fee_active_tvl_ratio)}%`;
    const holders = p.base_token_holders ?? p.holders ?? "?";
    const mcap  = `$${Number(p.base_token_market_cap ?? p.token_x?.market_cap ?? 0).toLocaleString("en", { maximumFractionDigits: 0 })}`;
    const volatility = fmt(p.volatility ?? 0, 3);
    const pool  = p.pool_address || "";
    console.log(pad(pair, 22) + pad(tvl, 11) + pad(vol, 11) + pad(feeTvl, 10) + pad(holders, 9) + pad(mcap, 13) + pad(volatility, 10) + pool);
  }
}

console.log(`\n━━━ CONFIG AKTIF ━━━`);
console.log(`Timeframe: ${s.timeframe} | Category: ${s.category}`);
console.log(`TVL: $${s.minTvl}-$${s.maxTvl} | Vol≥$${s.minVolume} | Organic≥${s.minOrganic} | Holders≥${s.minHolders} | Mcap≥$${s.minMcap} | fee/TVL≥${s.minFeeActiveTvlRatio}%`);

console.log(`\n━━━ DENGAN FILTER PENUH (sama persis seperti bot) ━━━`);
try {
  const full = await fetchPools(botFilters);
  console.log(`Hasil: ${full.length} pool\n`);
  if (full.length) printPools(full);
  else console.log("⛔ 0 pool — semua difilter");
} catch (e) {
  console.log(`Error: ${e.message}`);
}

console.log(`\n━━━ TANPA FILTER ORGANIC (untuk lihat apa yang tersedia) ━━━`);
try {
  const noOrganic = await fetchPools(noOrganicFilters);
  console.log(`Hasil: ${noOrganic.length} pool\n`);
  if (noOrganic.length) printPools(noOrganic);
  else console.log("⛔ 0 pool — masih tidak ada");
} catch (e) {
  console.log(`Error: ${e.message}`);
}
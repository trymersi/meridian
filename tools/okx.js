/**
 * OKX on-chain signal enrichment.
 *
 * NOTE: This is a stub. The full implementation was not included in the
 * repo update. All functions return null/[] so screening runs normally
 * without OKX signals — no wash/bundle/ATH filtering until this is replaced
 * with the real API integration.
 *
 * Expected return shapes (for reference when implementing):
 *   getAdvancedInfo → { risk_level, bundle_pct, sniper_pct, suspicious_pct,
 *                        smart_money_buy, dev_sold_all, dex_boost,
 *                        dex_screener_paid, creator }
 *   getPriceInfo    → { price_vs_ath_pct, ath }
 *   getClusterList  → [{ has_kol, trend, holding_pct }]
 *   getRiskFlags    → { is_rugpull, is_wash }
 */

import { log } from "../logger.js";

export async function getAdvancedInfo(mint) {
  return null;
}

export async function getPriceInfo(mint) {
  return null;
}

export async function getClusterList(mint) {
  return [];
}

export async function getRiskFlags(mint) {
  return null;
}

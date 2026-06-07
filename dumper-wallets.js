/**
 * Dumper wallets — wallets identified as mastermind dumpers (coordinated rings).
 *
 * Hermes uses GMGN to find wallets that coordinate-dump tokens in seconds.
 * These wallets are fed here so Meridian screening can SKIP pools where they
 * appear as top holders — avoiding pools almost certain to get dumped.
 *
 * Data source: Hermes → GMGN forensic pipeline → dumper-wallets.json
 */

import fs from "fs";
import { log } from "./logger.js";

const DUMPER_FILE = "./dumper-wallets.json";

function load() {
  if (!fs.existsSync(DUMPER_FILE)) return { wallets: {} };
  try {
    return JSON.parse(fs.readFileSync(DUMPER_FILE, "utf8"));
  } catch (error) {
    log("dumper_error", `Invalid ${DUMPER_FILE}: ${error.message}`);
    throw new Error(`Dumper wallet list is unreadable: ${DUMPER_FILE}`);
  }
}

function save(data) {
  fs.writeFileSync(DUMPER_FILE, JSON.stringify(data, null, 2));
}

// ─── Check ─────────────────────────────────────────────────────

/**
 * Returns true if ANY of the given wallets is a known dumper.
 * @param {string[]} wallets - Array of wallet addresses to check
 */
export function hasDumper(wallets) {
  if (!wallets || wallets.length === 0) return false;
  const db = load();
  return wallets.some(w => db.wallets[w]);
}

/**
 * Returns the dumper entries that match the given wallets.
 * @param {string[]} wallets
 * @returns {Array<{wallet, label, added_at, source}>}
 */
export function matchDumpers(wallets) {
  if (!wallets || wallets.length === 0) return [];
  const db = load();
  return wallets
    .filter(w => db.wallets[w])
    .map(w => ({ wallet: w, ...db.wallets[w] }));
}

// ─── Tool Handlers ─────────────────────────────────────────────

/**
 * Tool handler: add_dumper_wallet
 * Called by Hermes (or manual via Telegram) to feed a detected dumper wallet.
 */
export function addDumperWallet({ wallet, label, reason, source }) {
  if (!wallet) return { error: "wallet address required" };

  const db = load();

  if (db.wallets[wallet]) {
    return {
      already_tracked: true,
      wallet,
      label: db.wallets[wallet].label,
      reason: db.wallets[wallet].reason,
    };
  }

  db.wallets[wallet] = {
    label: label || "dumper",
    reason: reason || "detected via GMGN forensic pipeline",
    added_at: new Date().toISOString(),
    source: source || "hermes-gmgn",
  };

  save(db);
  log("dumper", `Added dumper wallet ${wallet.slice(0, 8)}... — ${label || "dumper"}: ${reason || ""}`);
  return { added: true, wallet, label };
}

/**
 * Tool handler: list_dumper_wallets
 */
export function listDumperWallets() {
  const db = load();
  const entries = Object.entries(db.wallets).map(([wallet, info]) => ({
    wallet,
    ...info,
  }));

  return {
    count: entries.length,
    dumper_wallets: entries,
  };
}

/**
 * Tool handler: remove_dumper_wallet
 */
export function removeDumperWallet({ wallet }) {
  if (!wallet) return { error: "wallet address required" };

  const db = load();

  if (!db.wallets[wallet]) {
    return { error: `Wallet ${wallet} not found in dumper list` };
  }

  const entry = db.wallets[wallet];
  delete db.wallets[wallet];
  save(db);
  log("dumper", `Removed ${entry.label || wallet.slice(0, 8)} from dumper list`);
  return { removed: true, wallet, was: entry };
}

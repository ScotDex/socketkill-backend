// src/services/customPrices.js
//
// EVE-KILL curated price overrides. ~76 rows, no auth, tiny payload.
//
// Precedence in priceService.getPrice():
//   MANUAL_PRICES -> customPrices -> Janice -> ESI -> 0
//
// Overrides sit ABOVE Janice deliberately. The existence of an override is a
// statement that market data is untrustworthy for that type — that cuts both
// ways: titans have no market at all, while items like the Khumaak and the
// Drifter Elements are overridden DOWN to 0.01 because their market price is
// misleading. Either way the override should win over a market-derived price.

const talker = require('../network/agent');

const URL = 'https://api.eve-kill.com/sde/custom-prices';
const REFRESH_MS = 24 * 60 * 60 * 1000;

let overrideMap = new Map();
let refreshTimer = null;

/**
 * Build the map from the raw rows.
 *
 * `valid_until` is the LAST date an override applies to. Open-ended rows use
 * the 9999-12-31 sentinel. A type may have several rows if its override
 * changed over time, so we must not naively last-write-wins — that would
 * silently pick a historical price.
 *
 * ISO dates (YYYY-MM-DD) compare correctly as plain strings, so no date
 * parsing is needed: '9999-12-31' > '2026-07-27' lexicographically.
 */
function buildOverrideMap(rows) {
  const today = new Date().toISOString().slice(0, 10);
  const out = new Map();
  const chosen = new Map();   // type_id -> valid_until we picked

  for (const row of rows) {
    const id = row?.type_id;
    const price = row?.price;
    const until = row?.valid_until;

    if (!Number.isFinite(id)) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    if (typeof until !== 'string') continue;
    if (until < today) continue;                 // expired

    // On collision keep the row expiring soonest — that's the one currently
    // in force. A later row is a future override, not the active one.
    const held = chosen.get(id);
    if (held != null && held <= until) continue;

    chosen.set(id, until);
    out.set(id, price);
  }

  return out;
}

async function loadCustomPrices() {
  try {
    const res = await talker.get(URL, { timeout: 15_000 });
    const rows = res.data?.data;

    if (!Array.isArray(rows)) {
      console.warn('[CUSTOM] Unexpected payload shape — keeping previous overrides');
      return;
    }

    const next = buildOverrideMap(rows);

    if (next.size === 0) {
      console.warn('[CUSTOM] No usable overrides parsed — keeping previous');
      return;
    }

    overrideMap = next;
    console.log(`[CUSTOM] Loaded ${overrideMap.size} price overrides (${rows.length} rows)`);
  } catch (err) {
    // Never fatal. Falls through to Janice/ESI, same as before this existed.
    console.error(`[CUSTOM] Load failed: ${err.message}`);
  }
}

function startCustomPriceSync(intervalMs = REFRESH_MS) {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    loadCustomPrices().catch((e) =>
      console.error(`[CUSTOM] Scheduled refresh threw: ${e.message}`)
    );
  }, intervalMs);
  if (refreshTimer.unref) refreshTimer.unref();
  console.log(`[CUSTOM] Override refresh scheduled every ${(intervalMs / 3_600_000).toFixed(1)}h`);
}

/** Returns an override price, or null to fall through to Janice/ESI. */
function getCustomPrice(typeId) {
  const v = overrideMap.get(typeId);
  return v != null ? v : null;
}

function getOverrideCount() {
  return overrideMap.size;
}

module.exports = {
  loadCustomPrices,
  startCustomPriceSync,
  getCustomPrice,
  getOverrideCount,
};

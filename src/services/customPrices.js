const talker = require('../network/agent');

const URL = 'https://api.eve-kill.com/sde/custom-prices';
const REFRESH_MS = 24 * 60 * 60 * 1000;

let overrideMap = new Map();
let refreshTimer = null;

function buildOverrideMap(rows) {
  const today = new Date().toISOString().slice(0, 10);
  const out = new Map();
  const chosen = new Map();   

  for (const row of rows) {
    const id = row?.type_id;
    const price = row?.price;
    const until = row?.valid_until;

    if (!Number.isFinite(id)) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    if (typeof until !== 'string') continue;
    if (until < today) continue;                 
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

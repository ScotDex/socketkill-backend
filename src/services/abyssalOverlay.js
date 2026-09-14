const talker = require('../network/agent');

const URL = 'https://mutamarket.com/api/estimator-statistics';
const REFRESH_MS = 24 * 60 * 60 * 1000;

let abyssalMap = new Map();
let refreshTimer = null;


function derivePrice(row) {
  const id = row?.type_id;
  const mae = row?.mae;
  const nmae = row?.nmae;

  if (!Number.isFinite(id)) return null;
  if (!Number.isFinite(mae) || mae <= 0) return null;
  if (!Number.isFinite(nmae) || nmae <= 0) return null;

  const price = (mae * 100) / nmae;
  if (!Number.isFinite(price) || price <= 0) return null;

  return [id, price];
}

function buildAbyssalMap(rows) {
  const out = new Map();
  for (const row of rows) {
    const hit = derivePrice(row);
    if (hit) out.set(hit[0], hit[1]);
  }
  return out;
}

async function loadAbyssalPrices() {
  try {
    const res = await talker.get(URL, {
      headers: { 'Accept': 'application/json' },
      timeout: 15_000,
    });

    const rows = res.data;
    if (!Array.isArray(rows)) {
      console.warn('[ABYSSAL] Unexpected payload shape — keeping previous overlay');
      return;
    }

    const next = buildAbyssalMap(rows);
    if (next.size === 0) {
      console.warn('[ABYSSAL] No usable prices parsed — keeping previous overlay');
      return;
    }

    abyssalMap = next;
    console.log(`[ABYSSAL] Loaded ${abyssalMap.size} type prices (${rows.length} rows)`);
  } catch (err) {
    console.error(`[ABYSSAL] Load failed: ${err.message}`);
  }
}

function startAbyssalSync(intervalMs = REFRESH_MS) {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    loadAbyssalPrices().catch((e) =>
      console.error(`[ABYSSAL] Scheduled refresh threw: ${e.message}`)
    );
  }, intervalMs);
  if (refreshTimer.unref) refreshTimer.unref();
  console.log(`[ABYSSAL] Refresh scheduled every ${(intervalMs / 3_600_000).toFixed(1)}h`);
}

function getAbyssalPrice(typeId) {
  const v = abyssalMap.get(typeId);
  return v != null ? v : null;
}

function getAbyssalCount() {
  return abyssalMap.size;
}

module.exports = {
  loadAbyssalPrices,
  startAbyssalSync,
  getAbyssalPrice,
  getAbyssalCount,
};

const talker = require('../network/agent');

const JANICE_BASE = 'https://janice.e-351.com/api/rest/v2';
const API_KEY = process.env.JANICE_API_KEY;
const MARKET_ID = 2;                 // Jita 4-4


const CHUNK_SIZE = 200;
const CHUNK_DELAY_MS = 1000;         
const PASS_INTERVAL_MS = 24 * 60 * 60 * 1000;

let janiceMap = new Map();
let overlayTimer = null;
let passRunning = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchChunk(typeIDs) {
  const res = await talker.post(
    `${JANICE_BASE}/pricer?market=${MARKET_ID}`,
    typeIDs.join('\n'),
    {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'text/plain',
        'X-ApiKey': API_KEY,
      },
      timeout: 30_000,
    }
  );
  return Array.isArray(res.data) ? res.data : [];
}

function accept(entry) {
  const id = entry?.itemType?.eid;
  const sells = entry?.sellOrderCount;
  const buys = entry?.buyOrderCount;
  const price = entry?.immediatePrices?.splitPrice30DayMedian;

  if (!Number.isFinite(id)) return null;
  if (!(sells > 0) || !(buys > 0)) return null;
  if (!Number.isFinite(price) || price <= 0) return null;

  return [id, price];
}

async function runOverlayPass(typeIDs) {
  if (!API_KEY) {
    console.warn('[JANICE] JANICE_API_KEY not set — overlay disabled');
    return;
  }
  if (passRunning) {
    console.warn('[JANICE] Pass already running — skipping');
    return;
  }
  if (!Array.isArray(typeIDs) || typeIDs.length === 0) {
    console.warn('[JANICE] No typeIDs supplied — skipping pass');
    return;
  }

  passRunning = true;
  const started = Date.now();
  const staging = new Map();
  const batches = chunk(typeIDs, CHUNK_SIZE);

  let ok = 0;
  let failed = 0;
  let rejected = 0;

  try {
    for (let i = 0; i < batches.length; i++) {
      try {
        const rows = await fetchChunk(batches[i]);
        for (const row of rows) {
          const hit = accept(row);
          if (hit) staging.set(hit[0], hit[1]);
          else rejected++;
        }
        ok++;
      } catch (err) {
        failed++;
        const status = err.response?.status;
        console.error(`[JANICE] Chunk ${i + 1}/${batches.length} failed: ${status || err.message}`);
        // 401/403 means the key is bad — no point hammering through the rest.
        if (status === 401 || status === 403) {
          console.error('[JANICE] Auth rejected — aborting pass');
          break;
        }
      }
      if (i < batches.length - 1) await sleep(CHUNK_DELAY_MS);
    }
    if (staging.size > 0) {
      janiceMap = staging;
    } else {
      console.warn('[JANICE] Pass produced no usable prices — keeping previous overlay');
    }

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[JANICE] Pass complete in ${secs}s | ${janiceMap.size} priced | ` +
      `${rejected} rejected (thin/no market) | ${ok} ok, ${failed} failed chunks`
    );
  } finally {
    passRunning = false;
  }
}

function startJaniceOverlay(getTypeIDs, intervalMs = PASS_INTERVAL_MS) {
  if (overlayTimer) return;
  if (!API_KEY) {
    console.warn('[JANICE] JANICE_API_KEY not set — overlay not scheduled');
    return;
  }
  overlayTimer = setInterval(() => {
    runOverlayPass(getTypeIDs()).catch((e) =>
      console.error(`[JANICE] Scheduled pass threw: ${e.message}`)
    );
  }, intervalMs);
  if (overlayTimer.unref) overlayTimer.unref();
  console.log(`[JANICE] Overlay scheduled every ${(intervalMs / 3_600_000).toFixed(1)}h`);
}

function getJanicePrice(typeId) {
  const v = janiceMap.get(typeId);
  return v != null ? v : null;
}

function getOverlaySize() {
  return janiceMap.size;
}

module.exports = {
  runOverlayPass,
  startJaniceOverlay,
  getJanicePrice,
  getOverlaySize,
};
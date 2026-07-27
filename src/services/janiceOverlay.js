// src/services/janiceOverlay.js
//
// Janice price overlay. Sits ON TOP of the ESI priceMap — never replaces it.
// Precedence in priceService.getPrice():  MANUAL_PRICES -> Janice -> ESI -> 0
//
// If Janice is down, the key is revoked, or a response is malformed, this
// degrades to exactly the pre-existing ESI behaviour. It must never be able
// to break pricing.

const talker = require('../network/agent');

const JANICE_BASE = 'https://janice.e-351.com/api/rest/v2';
const API_KEY = process.env.JANICE_API_KEY;
const MARKET_ID = 2;                 // Jita 4-4

// Batch limit is UNDOCUMENTED. 200 is a conservative starting point —
// test upward and raise this once the real ceiling is known.
const CHUNK_SIZE = 200;
const CHUNK_DELAY_MS = 1000;         // politeness gap between chunks
const PASS_INTERVAL_MS = 12 * 60 * 60 * 1000;

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

// THE GATE. Proven necessary by the capital-hull test: an Erebus with zero
// sell orders returns splitPrice = buyPrice/2 = 220M against a real value
// near 90B. Plausible-looking garbage is worse than no answer.
//
// Reject unless there is a real two-sided market AND a 30-day median.
// Rejected entries fall through to ESI — we never substitute another
// Janice field.
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

/**
 * Run one full overlay pass over the supplied typeIDs.
 * Builds into a staging map and swaps at the end — a mid-pass crash leaves
 * the previous overlay intact rather than half-destroyed.
 */
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

    // Only swap if we got something. An empty result means total failure,
    // and keeping the previous overlay is strictly better than clearing it.
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

/**
 * Schedule recurring passes. getTypeIDs is a function so the working set is
 * resolved fresh at each pass rather than captured once at boot.
 */
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

/** Returns a Janice price, or null to fall through to ESI. */
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
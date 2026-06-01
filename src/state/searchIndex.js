const r2 = require("../network/r2Writer");
const FLUSH_INTERVAL = 50;
const shardCache = new Map();
const SHARD_CACHE_MAX = 30;
const cache = new Map();
let currentDate = todayUTC();
let addedSinceFlush = 0;

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function shardKey(date) {
  return `search-index/${date}.json`;
}

async function prime() {
  currentDate = todayUTC();
  const saved = await r2.get(shardKey(currentDate));
  if (saved && typeof saved === 'object') {
    for (const [killID, value] of Object.entries(saved)) {
      cache.set(parseInt(killID), value);
    }
    console.log(`[INDEX] Primed ${cache.size} index entries for ${currentDate}`);
  } else {
    console.log(`[INDEX] No existing search index for ${currentDate} — starting fresh`);
  }
}

function set(killID, indexData) {
  if (!killID || !indexData) return;
  if (cache.has(killID)) return;
  cache.set(killID, indexData);
  addedSinceFlush++;
  if (addedSinceFlush >= FLUSH_INTERVAL) {
    flush();
  }
}

function get(killID) {
  return cache.get(killID) || null;
}

async function flush() {
  if (cache.size === 0) return;
  const snapshot = Object.fromEntries(cache);
  addedSinceFlush = 0;
  const ok = await r2.put(shardKey(currentDate), snapshot);
  if (ok) {
    console.log(`[INDEX] Flushed ${cache.size} entries to ${shardKey(currentDate)}`);
  }
}

async function rotateIfNeeded() {
  const today = todayUTC();
  if (today === currentDate) return;
  console.log(`[INDEX] UTC date rolled ${currentDate} -> ${today}. Sealing index shard.`);
  await flush();
  cache.clear();
  addedSinceFlush = 0;
  currentDate = today;
  console.log(`[INDEX] New day started: ${currentDate}`);
}

async function getShard(date) {
  if (date === todayUTC()) {
    return Object.fromEntries(cache);
  }

  let shard = shardCache.get(date);
  if (!shard) {
    shard = await r2.get(shardKey(date));
    if (!shard) return {};
    console.log(`[INDEX] Loaded shard ${date} from R2 (${Object.keys(shard).length} entries)`);
    shardCache.set(date, shard);
    if (shardCache.size > SHARD_CACHE_MAX) {
      const oldest = shardCache.keys().next().value;
      shardCache.delete(oldest);
    }
  }
  return shard;
}

function getAllToday() {
  return Array.from(cache.entries());
}

module.exports = { prime, set, get, flush, rotateIfNeeded, getShard, getAllToday };
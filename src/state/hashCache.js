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
  return `hashes/${date}.json`;
}

function entryHash(entry) {
  if (!entry) return null;
  return typeof entry === 'string' ? entry : entry.hash;
}

function entryShipID(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return entry.shipID || null;
}

async function prime() {
  currentDate = todayUTC();
  const saved = await r2.get(shardKey(currentDate));
  if (saved && typeof saved === 'object') {
    for (const [killID, value] of Object.entries(saved)) {
      cache.set(parseInt(killID), value);
    }
    console.log(`[HASH] Primed ${cache.size} hashes for ${currentDate}`);
  } else {
    console.log(`[HASH] No existing shard for ${currentDate} — starting fresh`);
  }
}

function set(killID, hash, shipTypeID = null) {
  if (!killID || !hash) return;
  if (cache.has(killID)) return;
  cache.set(killID, shipTypeID ? { hash, shipID: shipTypeID } : hash);
  addedSinceFlush++;
  if (addedSinceFlush >= FLUSH_INTERVAL) {
    flush();
  }
}

function get(killID) {
  return entryHash(cache.get(killID));
}

function getShipID(killID) {
  return entryShipID(cache.get(killID));
}

async function flush() {
  if (cache.size === 0) return;
  const snapshot = Object.fromEntries(cache);
  addedSinceFlush = 0;
  const ok = await r2.put(shardKey(currentDate), snapshot);
  if (ok) {
    console.log(`[HASH] Flushed ${cache.size} hashes to ${shardKey(currentDate)}`);
  }
}

async function rotateIfNeeded() {
  const today = todayUTC();
  if (today === currentDate) return;
  console.log(`[HASH] UTC date rolled ${currentDate} -> ${today}. Sealing shard.`);
  await flush();
  cache.clear();
  addedSinceFlush = 0;
  currentDate = today;
  console.log(`[HASH] New day started: ${currentDate}`);
}

async function getHashFromShard(date, killID) {
  if (date === todayUTC()) return get(killID);
  let shard = shardCache.get(date);
  if (!shard) {
    shard = await r2.get(shardKey(date));
    if (!shard) return null;
    console.log(`[HASH] Loaded shard ${date} from R2 (${Object.keys(shard).length} kills)`);
    shardCache.set(date, shard);
    if (shardCache.size > SHARD_CACHE_MAX) {
      const oldest = shardCache.keys().next().value;
      shardCache.delete(oldest);
    }
  }
  const entry = shard[killID] || shard[String(killID)] || null;
  return entryHash(entry);
}

function getAllToday() {
  return Array.from(cache.entries()).map(([killID, value]) => [String(killID), value]);
}

function findDateForKill(killID) {
  const id = parseInt(killID, 10);
  if (cache.has(id)) return todayUTC();
  for (const [date, shard] of shardCache) {
    if (shard[id] || shard[String(id)]) return date;
  }
  return null;
}

function search(filters) {
  const results = [];
  for (const [killID, entry] of cache.entries()) {
    if (!entry || typeof entry !== 'object') continue;

    if (filters.shipGroups?.size && !filters.shipGroups.has(entry.shipGroupID)) continue;
    if (filters.systems?.size && !filters.systems.has(entry.systemID)) continue;
    if (filters.regions?.size && !filters.regions.has(entry.regionID)) continue;
    if (filters.spaces?.size && !filters.spaces.has(entry.space)) continue;
    if (filters.minValue && (entry.totalValue || 0) < filters.minValue) continue;
    if (filters.maxValue !== Infinity && (entry.totalValue || 0) > filters.maxValue) continue;
    if (filters.minAttackers && (entry.attackerCount || 0) < filters.minAttackers) continue;
    if (filters.maxAttackers !== Infinity && (entry.attackerCount || 0) > filters.maxAttackers) continue;
    if (filters.victimCorps?.size && !filters.victimCorps.has(entry.victimCorpID)) continue;
    if (filters.victimAlliances?.size && !filters.victimAlliances.has(entry.victimAllianceID)) continue;
    if (filters.solo && (entry.attackerCount || 0) !== 1) continue;

    results.push({ killID, ...entry });
  }
  return results;
}

module.exports = { prime, set, get, getShipID, flush, rotateIfNeeded, getHashFromShard, getAllToday, findDateForKill, search };
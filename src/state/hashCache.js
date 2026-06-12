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
  const {
    shipGroups = [], systems = [], regions = [], spaces = [],
    victimCorps = [], victimAlliances = [],
    minValue = 0, maxValue = Infinity,
    minAttackers = 0, maxAttackers = Infinity,
    solo = false, minTime = 0,
  } = filters;

  const matches = [];
  for (const [killID, entry] of cache.entries()) {
    if (!entry || typeof entry !== 'object') continue;

    if (shipGroups.length      && !shipGroups.includes(entry.shipGroupID)) continue;
    if (systems.length         && !systems.includes(entry.systemID)) continue;
    if (regions.length         && !regions.includes(entry.regionID)) continue;
    if (spaces.length          && !spaces.includes(entry.space)) continue;
    if (victimCorps.length     && !victimCorps.includes(entry.victimCorpID)) continue;
    if (victimAlliances.length && !victimAlliances.includes(entry.victimAllianceID)) continue;
    if (minTime && (!entry.time || new Date(entry.time).getTime() < minTime)) continue;
    if ((entry.totalValue || 0) < minValue) continue;
    if (maxValue !== Infinity && (entry.totalValue || 0) > maxValue) continue;
    if ((entry.attackerCount || 0) < minAttackers) continue;
    if (maxAttackers !== Infinity && (entry.attackerCount || 0) > maxAttackers) continue;
    if (solo && (entry.attackerCount || 0) !== 1) continue;

    matches.push({ killID: Number(killID), ...entry });
  }

  matches.reverse(); 
  return matches;
}

module.exports = { prime, set, get, getShipID, flush, rotateIfNeeded, getHashFromShard, getAllToday, findDateForKill, search };
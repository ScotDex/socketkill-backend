
const r2 = require("../network/r2Writer");

const FLUSH_INTERVAL = 50;
const shardCache = new Map();
const SHARD_CACHE_MAX = 30;

const cache = new Map();
let currentDate = todayUTC();
let addedSinceFlush = 0;

function todayUTC(){
    return new Date().toISOString().slice(0, 10);
}

function shardKey(date) {
    return `hashes/${date}.json`;
}

async function prime() {
    currentDate = todayUTC();
    const saved = await r2.get(shardKey(currentDate));
    if (saved && typeof saved === 'object') {
        for (const [killID, hash] of Object.entries(saved)){
            cache.set(parseInt(killID), hash)
        }
        console.log(`[HASH] Primed ${cache.size} hashes for ${currentDate}`);
    } else {
        console.log(`[HASH] No existing shard for ${currentDate} — starting fresh`);
    }
}

function set(killID, hash) {
    if (!killID || !hash) return;
    if (cache.has(killID)) return;  // dedupe — hashes are immutable
    cache.set(killID, hash);
    addedSinceFlush++;
    if (addedSinceFlush >= FLUSH_INTERVAL) {
        flush();  // fire and forget
    }
}

function get(killID) {
    return cache.get(killID) || null
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
    await flush();           // final flush of yesterday into yesterday's key
    cache.clear();
    addedSinceFlush = 0;
    currentDate = today;
    console.log(`[HASH] New day started: ${currentDate}`);
}

async function getHashFromShard(date, killID) {
    if (date === todayUTC()) return get(killID)
    let shard = shardCache.get(date);
    if(!shard) {
        shard = await r2.get(shardKey(date));
        if (!shard) return null;
        console.log(`[HASH] Loaded shard ${date} from R2 (${Object.keys(shard).length} kills)`);
        shardCache.set(date, shard);
        if(shardCache.size > SHARD_CACHE_MAX) {
            const oldest = shardCache.keys().next().value;
            shardCache.delete(oldest);
        }        
    }
    return shard[killID] || shard[String(killID)] || null;
}

module.exports = { prime, set, get, flush, rotateIfNeeded, getHashFromShard };
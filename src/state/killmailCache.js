const talker = require("../network/agent");

const MAX_ENTRIES = 5000;
const ESI_BASE = "https://esi.evetech.net/latest/killmails";
const ESI_HEADERS = { "X-Compatibility-Date": "2025-12-16" };

// LRU: Map preserves insertion order, so we delete + re-set on access
// to move "recently used" entries to the end. Eviction pops the oldest (first).
const cache = new Map();

// In-flight dedup: if a fetch is already running for a killID,
// concurrent requests await the same Promise instead of starting their own.
const inflight = new Map();

function lruGet(killID) {
    if (!cache.has(killID)) return null;
    const value = cache.get(killID);
    cache.delete(killID);
    cache.set(killID, value);  // re-insert to mark as most recently used
    return value;
}

function lruSet(killID, value) {
    if (cache.has(killID)) cache.delete(killID);
    cache.set(killID, value);
    if (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
}

async function fetchFromESI(killID, hash) {
    const url = `${ESI_BASE}/${killID}/${hash}/`;
    const res = await talker.get(url, { headers: ESI_HEADERS, timeout: 5000 });
    return res.data;
}

async function get(killID, hash) {
    // Cache hit — fast path
    const cached = lruGet(killID);
    if (cached) return cached;

    // In-flight dedup — second caller awaits the first one's promise
    if (inflight.has(killID)) {
        return await inflight.get(killID);
    }

    // First caller starts the fetch
    const promise = fetchFromESI(killID, hash)
        .then(data => {
            lruSet(killID, data);
            inflight.delete(killID);
            return data;
        })
        .catch(err => {
            inflight.delete(killID);  // critical: clear on error so retry is possible
            console.error(`[KILLCACHE] ESI fetch failed for kill ${killID}: ${err.message}`);
            throw err;
        });

    inflight.set(killID, promise);
    return await promise;
}

function stats() {
    return { cached: cache.size, inflight: inflight.size, max: MAX_ENTRIES };
}

module.exports = { get, stats };
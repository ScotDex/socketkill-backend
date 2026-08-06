const talker = require("../network/agent");
const r2 = require("../network/r2Writer");

const MAX_ENTRIES = 5000;
const ESI_BASE = "https://esi.evetech.net/killmails";
const ESI_HEADERS = { "X-Compatibility-Date": "2025-12-16" };

const cache = new Map();
const inflight = new Map();

function lruGet(killID) {
    if (!cache.has(killID)) return null;
    const value = cache.get(killID);
    cache.delete(killID);
    cache.set(killID, value);  
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
    const cached = await r2.get(`killmails/${killID}.json`);
    if (cached) return cached;

    const url = `${ESI_BASE}/${killID}/${hash}/`;
    const res = await talker.get (url, { headers: ESI_HEADERS, timeout: 5000 });

        r2.put(`killmails/${killID}.json`, res.data).catch(err =>
        console.warn(`[KILLCACHE] R2 persist failed for ${killID}: ${err.message}`));

    return res.data;
}

async function get(killID, hash) {

    const cached = lruGet(killID);
    if (cached) return cached;
    if (inflight.has(killID)) {
        return await inflight.get(killID);
    }
    const promise = fetchFromESI(killID, hash)
        .then(data => {
            lruSet(killID, data);
            inflight.delete(killID);
            return data;
        })
        .catch(err => {
            inflight.delete(killID);  
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
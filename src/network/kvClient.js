const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const API_TOKEN = process.env.CF_API_TOKEN;

if (!ACCOUNT_ID || !NAMESPACE_ID || !API_TOKEN) {
    throw new Error ('kv-client: missing CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, or CF_API_TOKEN');
}

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}`;

const DEFAULT_HEADERS = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json'
}

const cache = new Map();

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()){
        cache.delete(key);
        return undefined
    }
    return entry.value;
}

function cacheSet(key, value, ttlMs) {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function get(key, opts = {}) {
    const { ttlMs = 3_600_000, parseJson = true, bypassCache = false } = opts;
 
    if (!bypassCache) {
        const cached = cacheGet(key);
        if (cached !== undefined) return cached;
    }
 
    const url = `${BASE_URL}/values/${encodeURIComponent(key)}`;
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
 
    if (res.status === 404) {
        cacheSet(key, null, ttlMs);
        return null;
    }
    if (!res.ok) {
        throw new Error(`kv-client.get(${key}): ${res.status} ${res.statusText}`);
    }
 
    const text = await res.text();
    const value = parseJson ? safeJsonParse(text) : text;
 
    cacheSet(key, value, ttlMs);
    return value;
}


async function put(key, value, opts = {}) {
    const { expirationTtl } = opts;
    const body = typeof value === 'string' ? value : JSON.stringify(value);
 
    let url = `${BASE_URL}/values/${encodeURIComponent(key)}`;
    if (expirationTtl) url += `?expiration_ttl=${expirationTtl}`;
 
    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${API_TOKEN}` }, // no JSON content-type — body is raw
        body
    });
 
    if (!res.ok) {
        throw new Error(`kv-client.put(${key}): ${res.status} ${res.statusText}`);
    }
 
    cache.delete(key);
}
 
/**
 * Delete a key from KV.
 * @param {string} key
 * @returns {Promise<void>}
 */
async function del(key) {
    const url = `${BASE_URL}/values/${encodeURIComponent(key)}`;
    const res = await fetch(url, { method: 'DELETE', headers: DEFAULT_HEADERS });
 
    if (!res.ok && res.status !== 404) {
        throw new Error(`kv-client.del(${key}): ${res.status} ${res.statusText}`);
    }
 
    cache.delete(key);
}

async function bulkPut(pairs) {
    if (!Array.isArray(pairs) || pairs.length === 0) return;
    if (pairs.length > 10_000) throw new Error('kv-client.bulkPut: max 10,000 pairs per call');
 
    const body = pairs.map(p => ({
        key: p.key,
        value: typeof p.value === 'string' ? p.value : JSON.stringify(p.value),
        ...(p.expiration_ttl ? { expiration_ttl: p.expiration_ttl } : {})
    }));
 
    const res = await fetch(`${BASE_URL}/bulk`, {
        method: 'PUT',
        headers: DEFAULT_HEADERS,
        body: JSON.stringify(body)
    });
 
    if (!res.ok) {
        throw new Error(`kv-client.bulkPut: ${res.status} ${res.statusText}`);
    }
 
    for (const p of pairs) cache.delete(p.key);
}

function clearCache() {
    cache.clear();
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

module.exports = {
    get,
    put,
    del,
    bulkPut,
    clearCache
};
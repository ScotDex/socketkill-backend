const r2 = require("../network/r2Writer");
const BUCKET = 1000;
const KEEP_BUCKETS = 2;      
const buffer = new Map();    
const dirty = new Set();     
const hydrated = new Set();  
const prefixOf = (killID) => Math.floor(killID / BUCKET);
const keyOf = (prefix) => `hashidx/${prefix}.json`;

function record(killID, hash) {
  const id = Number(killID);
  if (!Number.isFinite(id) || id <= 0 || !hash) return;
  if (buffer.get(id) === hash) return;
  buffer.set(id, hash);
  dirty.add(prefixOf(id));
}

function prune() {
  if (buffer.size === 0) return;

  let maxPrefix = -1;
  for (const id of buffer.keys()) {
    const p = prefixOf(id);
    if (p > maxPrefix) maxPrefix = p;
  }
  const floor = maxPrefix - (KEEP_BUCKETS - 1);

  let dropped = 0;
  for (const id of [...buffer.keys()]) {
    const p = prefixOf(id);
    if (p < floor && !dirty.has(p)) {
      buffer.delete(id);
      dropped++;
    }
  }

  for (const p of [...hydrated]) {
    if (p < floor && !dirty.has(p)) hydrated.delete(p);
  }

  if (dropped) console.log(`[HASHIDX] Pruned ${dropped} entries below bucket ${floor} (buffer=${buffer.size})`);
}

async function flushDirty() {
  if (dirty.size === 0) return;
  const prefixes = [...dirty];
  dirty.clear();

  for (const prefix of prefixes) {
    if (!hydrated.has(prefix)) {
      const existing = await r2.get(keyOf(prefix));
      if (existing && typeof existing === "object") {
        for (const [id, h] of Object.entries(existing)) {
          const n = Number(id);
          if (!buffer.has(n)) buffer.set(n, h);
        }
      }
      hydrated.add(prefix);
    }

    const shard = {};
    const lo = prefix * BUCKET;
    const hi = lo + BUCKET;
    for (const [id, h] of buffer) {
      if (id >= lo && id < hi) shard[id] = h;
    }

    const ok = await r2.put(keyOf(prefix), shard);
    if (ok) {
      console.log(`[HASHIDX] Flushed ${Object.keys(shard).length} to ${keyOf(prefix)}`);
    } else {
      dirty.add(prefix);
      console.warn(`[HASHIDX] PUT failed for ${keyOf(prefix)} — requeued`);
    }
  }

  prune();
}

async function getHashById(killID) {
  const id = Number(killID);
  if (!Number.isFinite(id) || id <= 0) return null;
  if (buffer.has(id)) return buffer.get(id);
  const shard = await r2.get(keyOf(prefixOf(id)));
  if (!shard) return null;
  return shard[String(id)] ?? shard[id] ?? null;
}

function stats() {
  return { buffered: buffer.size, dirty: dirty.size, hydrated: hydrated.size, bucket: BUCKET };
}

module.exports = { record, flushDirty, getHashById, prefixOf, stats };
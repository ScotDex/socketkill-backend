// src/services/reactionsManager.js
const r2 = require('../network/r2Writer');

const R2_KEY = 'reactions.json';
const DEDUP_MAX = 50000;
const SAVE_INTERVAL_MS = 60_000;

const ALLOWED_EMOTES = new Set(['plus1', 'f', 'nice-feed', 'o7', 'gf', '67', 'lol', 'RMT', 'FFS', 'RIP']);

const reactions = new Map();
const dedup = new Set();
let dirty = false;

async function recoverFromR2() {
  try {
    const saved = await r2.get(R2_KEY);
    if (saved && typeof saved === 'object') {
      for (const [id, emotes] of Object.entries(saved)) reactions.set(String(id), { ...emotes });
      console.log(`[REACT] Recovered ${reactions.size} kills from R2`);
    }
  } catch (err) { console.error(`[REACT] Recover failed: ${err.message}`); }
}

function react({ killmailId, emoteKey, ip }) {
  if (!killmailId || !emoteKey || !ip) return null;
  if (!ALLOWED_EMOTES.has(emoteKey)) return null;

  const id = String(killmailId);
  const dedupKey = `${ip}:${id}:${emoteKey}`;
  if (dedup.has(dedupKey)) return null;

  dedup.add(dedupKey);
  if (dedup.size > DEDUP_MAX) dedup.delete(dedup.values().next().value);

  let emotes = reactions.get(id);
  if (!emotes) { emotes = {}; reactions.set(id, emotes); }
  emotes[emoteKey] = (emotes[emoteKey] || 0) + 1;

  dirty = true;
  return { killmailId: id, emoteKey, count: emotes[emoteKey] };
}

function get(killmailId) { return reactions.get(String(killmailId)) || {}; }

async function save() {
  if (!dirty) return;
  try { await r2.put(R2_KEY, Object.fromEntries(reactions)); dirty = false; }
  catch (err) { console.error(`[REACT] Save failed: ${err.message}`); }
}

module.exports = { recoverFromR2, react, get, save, SAVE_INTERVAL_MS };
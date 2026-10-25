const axios = require('../network/agent');
const kickAuth = require('./kickAuth');

const API = 'https://api.kick.com/public/v1/events/subscriptions';
const IDLE_MS = 60 * 60 * 1000;
const MAX_SUBS = 200;

const subs = new Map();
const pending = new Map();
let io = null;
let ready = Promise.resolve();

const roomSize = id => io?.of('/').adapter.rooms.get(`kick:${id}`)?.size || 0;
const parseRoom = room => { const m = /^kick:(\d+)$/.exec(room); return m ? Number(m[1]) : null; };
const authHeaders = async () => ({ Authorization: 'Bearer ' + await kickAuth.getToken() });

async function loadExisting() {
  const { data } = await axios.get(API, { headers: await authHeaders(), timeout: 5000 });
  for (const s of data.data || []) {
    if (s.event !== 'chat.message.sent') continue;
    subs.set(s.broadcaster_user_id, { subId: s.id, idleTimer: null });
    scheduleIdle(s.broadcaster_user_id);
  }
  console.log(`[KICK SUBS] loaded ${subs.size} existing`);
}

function scheduleIdle(id) {
  const entry = subs.get(id);
  if (!entry || entry.idleTimer) return;
  entry.idleTimer = setTimeout(() => remove(id), IDLE_MS);
}

async function remove(id) {
  const entry = subs.get(id);
  if (!entry) return;
  if (roomSize(id) > 0) { entry.idleTimer = null; return; }
  subs.delete(id);
  try {
    await axios.delete(`${API}?id=${entry.subId}`, { headers: await authHeaders(), timeout: 5000 });
    console.log(`[KICK SUBS] unsubscribed ${id}`);
  } catch (err) {
    console.warn(`[KICK SUBS] unsubscribe ${id} failed:`, err.response?.status || err.message);
  }
}

function ensure(id) {
  const existing = subs.get(id);
  if (existing) { clearTimeout(existing.idleTimer); existing.idleTimer = null; return; }
  if (pending.has(id)) return;
  if (subs.size >= MAX_SUBS) return console.warn(`[KICK SUBS] cap reached, refused ${id}`);

  const p = (async () => {
    await ready;
    if (subs.has(id)) return;
    const { data } = await axios.post(API,
      { broadcaster_user_id: id, events: [{ name: 'chat.message.sent', version: 1 }], method: 'webhook' },
      { headers: await authHeaders(), timeout: 5000 });
    const subId = data?.data?.[0]?.subscription_id;
    if (!subId) throw new Error('no subscription_id in response');
    subs.set(id, { subId, idleTimer: null });
    console.log(`[KICK SUBS] subscribed ${id}`);
    if (roomSize(id) === 0) scheduleIdle(id);
  })()
    .catch(err => console.warn(`[KICK SUBS] subscribe ${id} failed:`, err.response?.status || err.message))
    .finally(() => pending.delete(id));

  pending.set(id, p);
}

function attach(ioInstance) {
  io = ioInstance;
  const adapter = io.of('/').adapter;
  adapter.on('join-room', room => { const id = parseRoom(room); if (id) ensure(id); });
  adapter.on('delete-room', room => { const id = parseRoom(room); if (id) scheduleIdle(id); });
  ready = loadExisting().catch(err => console.warn('[KICK SUBS] load existing failed:', err.response?.status || err.message));
}

module.exports = { attach };
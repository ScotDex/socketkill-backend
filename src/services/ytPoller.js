const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const axios = require('../network/agent');

const API = 'https://www.googleapis.com/youtube/v3';
const MAX_STREAMS = 3;
const RECONNECT_STEPS = [1_000, 5_000, 15_000, 30_000];
const RETRY_MS = 10_000;
const WAIT_MS = 3 * 60_000;
const BACKOFF_MS = 5 * 60_000;
const IDLE_MS = 60_000;
const STREAM_DEADLINE_MS = 60_000;
const DAILY_BUDGET = 9_000;

let client = null;
try {
  const def = protoLoader.loadSync(path.join(__dirname, 'stream_list.proto'), {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
  });
  const yt = grpc.loadPackageDefinition(def).youtube.api.v3;
  client = new yt.V3DataLiveChatMessageService('youtube.googleapis.com:443', grpc.credentials.createSsl());
} catch (err) {
  console.error('[YT POLL] gRPC setup failed, YouTube disabled:', err.message);
}

const streams = new Map();
let io = null;
let used = 0;
let usedDay = quotaDay();

function quotaDay() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function spend(units) {
  const today = quotaDay();
  if (today !== usedDay) { usedDay = today; used = 0; }
  if (used + units > DAILY_BUDGET) return false;
  used += units;
  return true;
}

function toOverlayMessage(item) {
  const a = item.author_details || {};
  const badges = [
    a.is_chat_owner && 'broadcaster/1',
    a.is_chat_moderator && 'moderator/1',
    a.is_chat_sponsor && 'subscriber/1',
  ].filter(Boolean).join(',');

  return {
    platform: 'youtube',
    user: 'yt:' + a.channel_id,
    text: item.snippet?.display_message || '',
    tags: {
      'display-name': (a.display_name || '').replace(/^@/, ''),
      color: '',
      badges,
      avatar: a.profile_image_url || '',
    },
  };
}

async function findLiveChat(channelId) {
  const { data: html } = await axios.get(`https://www.youtube.com/channel/${channelId}/live`, {
    timeout: 8000, responseType: 'text',
  });
  const ids = [...new Set([...String(html).matchAll(/watch\?v=([A-Za-z0-9_-]{11})/g)].map(m => m[1]))].slice(0, 20);
  if (!ids.length) { console.warn(`[YT POLL] ${channelId} no video IDs on /live page`); return null; }
  if (!spend(1)) return null;

  const { data } = await axios.get(`${API}/videos`, {
    params: { part: 'snippet,liveStreamingDetails', id: ids.join(','), key: process.env.YT_API_KEY },
    timeout: 5000,
  });
  const live = (data.items || []).find(v => {
    const d = v.liveStreamingDetails || {};
    return v.snippet?.channelId === channelId && d.actualStartTime && !d.actualEndTime && d.activeLiveChatId;
  });
  return live ? live.liveStreamingDetails.activeLiveChatId : null;
}

function schedule(s, channelId, ms) {
  if (!s.stopped) s.timer = setTimeout(() => run(channelId), ms);
}

async function run(channelId) {
  const s = streams.get(channelId);
  if (!s || s.stopped) return;

  if (!s.chatId) {
    try {
      s.chatId = await findLiveChat(channelId);
    } catch (err) {
      console.warn(`[YT POLL] ${channelId} live check failed:`, err.response?.status || err.message);
    }
    if (s.stopped) return;
    if (!s.chatId) return schedule(s, channelId, WAIT_MS);
    s.pageToken = null;
    s.idleRounds = 0;
    console.log(`[YT POLL] ${channelId} is live`);
  }

  if (!spend(5)) return schedule(s, channelId, WAIT_MS);
  openStream(channelId, s);
}

function openStream(channelId, s) {
  const meta = new grpc.Metadata();
  meta.add('x-goog-api-key', process.env.YT_API_KEY);

  const call = client.StreamList({
    live_chat_id: s.chatId,
    part: ['snippet', 'authorDetails'],
    profile_image_size: 48,
    page_token: s.pageToken || undefined,
  }, meta, { deadline: Date.now() + STREAM_DEADLINE_MS });
  s.call = call;

  let skipFirst = !s.pageToken;
  let ended = false;
  let delivered = 0;

  call.on('data', res => {
    if (res.next_page_token) s.pageToken = res.next_page_token;
    if (res.offline_at) ended = true;

    if (skipFirst) { skipFirst = false; return; }

    for (const item of res.items || []) {
      const type = item.snippet?.type;
      if (type === 'CHAT_ENDED_EVENT') ended = true;
      if (type === 'TEXT_MESSAGE_EVENT') {
        io.to(`yt:${channelId}`).emit('yt:chat', toOverlayMessage(item));
        delivered++;
      }
    }
  });

  call.on('error', () => {});

  call.on('status', st => {
    s.call = null;
    if (s.stopped) return;

    if (ended) {
      console.log(`[YT POLL] ${channelId} went offline`);
      s.chatId = null;
      return schedule(s, channelId, WAIT_MS);
    }

    switch (st.code) {
      case grpc.status.OK: {
        s.idleRounds = delivered > 0 ? 0 : s.idleRounds + 1;
        const step = RECONNECT_STEPS[Math.min(s.idleRounds, RECONNECT_STEPS.length - 1)];
        return schedule(s, channelId, step);
      }
      case grpc.status.FAILED_PRECONDITION:
      case grpc.status.NOT_FOUND:
        console.log(`[YT POLL] ${channelId} chat ended or disabled`);
        s.chatId = null;
        return schedule(s, channelId, WAIT_MS);
      case grpc.status.RESOURCE_EXHAUSTED:
      case grpc.status.PERMISSION_DENIED:
      case grpc.status.UNAUTHENTICATED:
        console.warn(`[YT POLL] ${channelId} backing off: code=${st.code} ${st.details}`);
        return schedule(s, channelId, BACKOFF_MS);
      default:
        console.warn(`[YT POLL] ${channelId} stream error: code=${st.code} ${st.details}`);
        return schedule(s, channelId, RETRY_MS);
    }
  });
}

const roomSize = id => io?.of('/').adapter.rooms.get(`yt:${id}`)?.size || 0;
const parseRoom = room => { const m = /^yt:(UC[A-Za-z0-9_-]{22})$/.exec(room); return m ? m[1] : null; };

function ensure(channelId) {
  const s = streams.get(channelId);
  if (s) { clearTimeout(s.idleTimer); s.idleTimer = null; return; }
  if (!client) return console.warn('[YT POLL] gRPC client unavailable');
  if (!process.env.YT_API_KEY) return console.warn('[YT POLL] no API key set');
  if (streams.size >= MAX_STREAMS) return console.warn(`[YT POLL] cap reached, refused ${channelId}`);

  streams.set(channelId, {
    chatId: null, pageToken: null, call: null, timer: null, idleTimer: null, stopped: false, idleRounds: 0,
  });
  console.log(`[YT POLL] started ${channelId}`);
  run(channelId);
}

function scheduleStop(channelId) {
  const s = streams.get(channelId);
  if (!s || s.idleTimer) return;
  s.idleTimer = setTimeout(() => {
    if (roomSize(channelId) > 0) { s.idleTimer = null; return; }
    s.stopped = true;
    clearTimeout(s.timer);
    if (s.call) s.call.cancel();
    streams.delete(channelId);
    console.log(`[YT POLL] stopped ${channelId}`);
  }, IDLE_MS);
}

function attach(ioInstance) {
  io = ioInstance;
  const adapter = io.of('/').adapter;
  adapter.on('join-room', room => { const id = parseRoom(room); if (id) ensure(id); });
  adapter.on('delete-room', room => { const id = parseRoom(room); if (id) scheduleStop(id); });
}

module.exports = { attach, toOverlayMessage };
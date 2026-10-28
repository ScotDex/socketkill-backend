const axios = require('../network/agent');

const API = 'https://www.googleapis.com/youtube/v3';
const MAX_STREAMS = 3;
const MIN_POLL_MS = 10_000;
const WAIT_MS = 3 * 60_000;
const IDLE_MS = 60_000;
const DAILY_BUDGET = 9_000;

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
  const a = item.authorDetails || {};
  const badges = [
    a.isChatOwner && 'broadcaster/1',
    a.isChatModerator && 'moderator/1',
    a.isChatSponsor && 'subscriber/1',
  ].filter(Boolean).join(',');

  return {
    platform: 'youtube',
    user: 'yt:' + a.channelId,
    text: item.snippet?.displayMessage || '',
    tags: {
      'display-name': (a.displayName || '').replace(/^@/, ''),
      color: '',
      badges,
      avatar: a.profileImageUrl || '',
    },
  };
}

async function findLiveChat(channelId) {
  const { data: html } = await axios.get(`https://www.youtube.com/channel/${channelId}/live`, {
    timeout: 8000, responseType: 'text',
  });
  const ids = [...new Set([...String(html).matchAll(/watch\?v=([A-Za-z0-9_-]{11})/g)].map(m => m[1]))].slice(0, 5);
  if (!ids.length) { console.warn(`[YT POLL] ${channelId} no video IDs on /live page`); return null; }
  if (!spend(1)) return null;

  const { data } = await axios.get(`${API}/videos`, {
    params: { part: 'liveStreamingDetails', id: ids.join(','), key: process.env.YT_API_KEY },
    timeout: 5000,
  });
  const live = (data.items || []).find(v => {
    const d = v.liveStreamingDetails || {};
    return d.actualStartTime && !d.actualEndTime && d.activeLiveChatId;
  });
  return live ? live.liveStreamingDetails.activeLiveChatId : null;
}

async function poll(channelId) {
  const s = streams.get(channelId);
  if (!s || s.stopped) return;
  let delay = WAIT_MS;

  try {
    if (!s.chatId) {
      s.chatId = await findLiveChat(channelId);
      s.pageToken = null;
      if (s.chatId) console.log(`[YT POLL] ${channelId} is live`);
    }

    if (s.chatId && spend(5)) {
      const { data } = await axios.get(`${API}/liveChat/messages`, {
        params: { liveChatId: s.chatId, part: 'snippet,authorDetails', pageToken: s.pageToken || undefined, key: process.env.YT_API_KEY },
        timeout: 5000,
      });

      if (s.pageToken) {
        for (const item of data.items || []) {
          if (item.snippet?.type === 'textMessageEvent') {
            io.to(`yt:${channelId}`).emit('yt:chat', toOverlayMessage(item));
          }
        }
      }
      s.pageToken = data.nextPageToken;
      delay = Math.max(MIN_POLL_MS, data.pollingIntervalMillis || 0);
      if (data.offlineAt) { s.chatId = null; delay = WAIT_MS; console.log(`[YT POLL] ${channelId} went offline`); }
    }
  } catch (err) {
    const status = err.response?.status;
    const reason = err.response?.data?.error?.errors?.[0]?.reason;
    console.warn(`[YT POLL] ${channelId} failed:`, status, reason || err.message);
    if (reason === 'quotaExceeded') used = DAILY_BUDGET;
    else if (status === 403 || status === 404) s.chatId = null;
    delay = s.chatId ? MIN_POLL_MS : WAIT_MS;
  }

  if (!s.stopped) s.timer = setTimeout(() => poll(channelId), delay);
}

const roomSize = id => io?.of('/').adapter.rooms.get(`yt:${id}`)?.size || 0;
const parseRoom = room => { const m = /^yt:(UC[A-Za-z0-9_-]{22})$/.exec(room); return m ? m[1] : null; };

function ensure(channelId) {
  const s = streams.get(channelId);
  if (s) { clearTimeout(s.idleTimer); s.idleTimer = null; return; }
  if (!process.env.YT_API_KEY) return console.warn('[YT POLL] no API key set');
  if (streams.size >= MAX_STREAMS) return console.warn(`[YT POLL] cap reached, refused ${channelId}`);

  streams.set(channelId, { chatId: null, pageToken: null, timer: null, idleTimer: null, stopped: false });
  console.log(`[YT POLL] started ${channelId}`);
  poll(channelId);
}

function scheduleStop(channelId) {
  const s = streams.get(channelId);
  if (!s || s.idleTimer) return;
  s.idleTimer = setTimeout(() => {
    if (roomSize(channelId) > 0) { s.idleTimer = null; return; }
    s.stopped = true;
    clearTimeout(s.timer);
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
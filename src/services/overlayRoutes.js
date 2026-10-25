const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { clientIp } = require('../core/requestMeta');
const kickVerify = require('./kickVerify');
const kickAuth = require('./kickAuth');

const router = express.Router();
let io = null;
kickVerify.loadKey().catch(err => console.error('[KICK WH] key load failed:', err.message));
kickAuth.getToken().catch(err => console.error('[KICK AUTH] failed:', err.response?.data || err.message));

const pingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
});

function toOverlayMessage(event) {
  const s = event.sender || {};
  const badges = (s.identity?.badges || []).map(b => `${b.type}/1`).join(',');
  return {
    platform: 'kick',
    user: s.channel_slug || String(s.user_id),
    text: typeof event.content === 'string' ? event.content : '',
    tags: {
      'display-name': s.username,
      color: s.identity?.username_color || '',
      badges,
    },
  };
}

router.post('/kick/webhook', express.raw({ type: 'application/json', limit: '64kb' }), (req, res) => {
  res.status(200).end();

  if (!Buffer.isBuffer(req.body)) return;

  const result = kickVerify.verify(req.headers, req.body);
  if (result !== 'ok') return console.warn(`[KICK WH] rejected: ${result}`);

    console.log('[KICK WH] verified', req.get('kick-event-type'));

  if (!io || req.get('kick-event-type') !== 'chat.message.sent') return;

  try {
    const event = JSON.parse(req.body.toString('utf8'));
    const id = event?.broadcaster?.user_id;
    if (Number.isInteger(id)) io.to(`kick:${id}`).emit('kick:chat', toOverlayMessage(event))
  } catch (err) {
    console.warn('[KICK WH] emit failed:', err.message);
  }

  });

router.post('/api/overlay-ping', pingLimiter, express.text({ type: 'text/plain', limit: '1kb' }), (req, res) => {
  res.status(204).end();

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return;
  }

  const channel = typeof body.channel === 'string' ? body.channel.toLowerCase() : '';
  const v = Number.isInteger(body.v) ? body.v : 0;
  if (!/^[a-z0-9_]{3,25}$/.test(channel)) return;

  console.log(`[OVERLAY PING] channel=${channel} v=${v}`);
});

   module.exports = (ioInstance) => {
     io = ioInstance;
     return router;
   };
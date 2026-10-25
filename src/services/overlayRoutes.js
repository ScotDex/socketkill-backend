const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { clientIp } = require('../core/requestMeta');

const router = express.Router();

const pingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
});


router.post('/kick/webhook', express.raw({ type: 'application/json', limit: '64kb' }), (req, res) => {
  res.status(200).end();

  const kickHeaders = Object.fromEntries(
    Object.entries(req.headers).filter(([k]) => k.startsWith('kick-'))
  );
  console.log('[KICK WH] headers', kickHeaders);
  console.log('[KICK WH] body', req.body.toString('utf8').slice(0, 500));
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

module.exports = router;
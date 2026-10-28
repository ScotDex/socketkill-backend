const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { clientIp } = require('../core/requestMeta');
const axios = require('../network/agent');
const ytPoller = require('./ytPoller');

const router = express.Router();

const resolveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
});

const handleCache = new Map();
const MISS_TTL = 10 * 60 * 1000;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

router.get('/api/yt/resolve', resolveLimiter, async (req, res) => {
  const handle = String(req.query.handle || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(handle)) {
    return res.status(400).json({ error: 'Invalid YouTube handle' });
  }

  const cached = handleCache.get(handle);
  if (cached?.id) return res.json({ id: cached.id });
  if (cached && Date.now() < cached.expires) {
    return res.status(404).json({ error: 'YouTube channel not found' });
  }

  const key = process.env.YT_API_KEY;
  if (!key) return res.status(503).json({ error: 'YouTube support unavailable' });

  try {
    const { data } = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'id', forHandle: '@' + handle, key },
      timeout: 5000,
    });
    const id = data?.items?.[0]?.id;
    if (handleCache.size > 1000) handleCache.clear();

    if (!CHANNEL_ID.test(id || '')) {
      handleCache.set(handle, { id: null, expires: Date.now() + MISS_TTL });
      return res.status(404).json({ error: 'YouTube channel not found' });
    }

    handleCache.set(handle, { id });
    res.json({ id });
  } catch (err) {
    console.warn(`[YT RESOLVE] ${handle} failed:`, err.response?.status || err.message);
    res.status(502).json({ error: 'Lookup failed' });
  }
});

module.exports = (ioInstance) => {
  ytPoller.attach(ioInstance);
  return router;
};
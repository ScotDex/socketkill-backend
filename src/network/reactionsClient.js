

const REACTIONS_ENABLED = process.env.REACTIONS_ENABLED === 'true';
const REACTION_TYPE = 'o7';
const REACTION_DISPLAY_CAP = 1000;          
const REACTION_DEDUP_TTL = 60 * 60 * 24 * 7;  
function reactIpHash(req) {
  const ip = req.get('CF-Connecting-IP')
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
  
  let h = 0;
  for (let i = 0; i < ip.length; i++) { h = (h * 31 + ip.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

const reactLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.get('CF-Connecting-IP')
      || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.ip;
    return ipKeyGenerator(ip);
  },
  message: { error: 'Too many reactions — slow down.' },
});

app.get('/api/reactions/:killID', async (req, res) => {
  const id = parseInt(req.params.killID);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid killID' });
  if (!REACTIONS_ENABLED) return res.json({ enabled: false, counts: {} });

  try {
    const data = await kvClient.get(`reactions:${id}`, { ttlMs: 30_000 });
    const raw = data?.[REACTION_TYPE] || 0;
    const display = raw > REACTION_DISPLAY_CAP ? `${REACTION_DISPLAY_CAP}+` : String(raw);
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: true, counts: { [REACTION_TYPE]: display } });
  } catch (err) {
    console.error(`[REACT] read ${id}: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/react/:killID', reactLimiter, async (req, res) => {
  if (!REACTIONS_ENABLED) return res.status(403).json({ error: 'Reactions disabled' });

  const id = parseInt(req.params.killID);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid killID' });

  const type = req.body?.type;
  if (type !== REACTION_TYPE) return res.status(400).json({ error: 'Unknown reaction' });

  try {
    const dedupKey = `react-seen:${id}:${reactIpHash(req)}`;
    const seen = await kvClient.get(dedupKey, { ttlMs: 0, bypassCache: true });
    if (seen) {
      const cur = await kvClient.get(`reactions:${id}`, { bypassCache: true });
      const raw = cur?.[REACTION_TYPE] || 0;
      const display = raw > REACTION_DISPLAY_CAP ? `${REACTION_DISPLAY_CAP}+` : String(raw);
      return res.status(200).json({ ok: true, already: true, counts: { [REACTION_TYPE]: display } });
    }

    const cur = await kvClient.get(`reactions:${id}`, { bypassCache: true }) || {};
    cur[REACTION_TYPE] = (cur[REACTION_TYPE] || 0) + 1;

    await kvClient.put(`reactions:${id}`, cur);
    await kvClient.put(dedupKey, '1', { expirationTtl: REACTION_DEDUP_TTL });

    const display = cur[REACTION_TYPE] > REACTION_DISPLAY_CAP
      ? `${REACTION_DISPLAY_CAP}+` : String(cur[REACTION_TYPE]);
    res.json({ ok: true, counts: { [REACTION_TYPE]: display } });
  } catch (err) {
    console.error(`[REACT] write ${id}: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});
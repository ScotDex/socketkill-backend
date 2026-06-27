require("dotenv").config();
const express = require("express");
const https = require("https");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const fs = require("fs");
const axios = require("../network/agent");
const hashCache = require("../state/hashCache");
const killmailCache = require("../state/killmailCache");
const helpers = require("../core/helpers");
const { resolveItems } = require('../core/itemResolver');
const pLimit = require('p-limit');
const kvClient = require('../network/kvClient');
const killmailResolver = require('../core/killmailResolver');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { clientIp, requestMeta, setCacheHeader, IMMUTABLE } = require('../core/requestMeta')
const r2 = require('../network/r2Writer');
const reactionsManager = require('../services/reactionsManager');
const plexRate = require('../services/plexRate');


const resolveLimit = pLimit(4);
const BOT_UA = /bot|crawler|spider|claude|gptbot|ccbot|bytespider|petalbot|slurp|bingbot|googlebot|facebookexternalhit|meta-external/i;

function startWebServer(esi, statsManager, sharedState, getProcessor) {
  const app = express();
  app.set('trust proxy', 1);

  const options = {
    key: fs.readFileSync(
      path.join(__dirname, "..", "..", "ssl", "socketkillcom.key"),
    ),
    cert: fs.readFileSync(
      path.join(__dirname, "..", "..", "ssl", "socketkillcom.pem"),
    ),
  };

  const server = https.createServer(options, app);

  const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = clientIp(req); return ipKeyGenerator(ip);
    },
    message: { error: 'Too many searches — slow down.' },
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(cors());
  app.use(express.json());

  const io = new Server(server, {
    pingTimeout: 2000,
    pingInterval: 5000,
    cors: {
      origin: [
        "https://socketkill.com",
        "https://pf.darkventure.space",
        "https://eveapex.com",
        "https://ws.socketkill.com",
        "https://incursions-dev.nesbit.solutions",
        "https://incursions.nesbit.solutions",
        "https://socketkill.com/map/",
        "https://socketkill.com/about/",
        "https://socketkill-v2.themadlyscientific.workers.dev",
      ],
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  const PORT = process.env.PORT;
  const publicPath = path.join(__dirname, "..", "..", "public");

  async function handleKillDetail(req, res) {
    let date, id, recoveredHash = null;

    id = parseInt(req.params.killID);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid killID.' });
    }

    const isBot = BOT_UA.test(req.get('User-Agent') || '');

    if (req.params.date) {
      date = req.params.date;

    } else {

      const now = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
        if (await hashCache.getHashFromShard(d, id)) {
          date = d;
          break;
        }
      }
      if (!date) {
        const km = await r2.get(`killmails/${id}.json`).catch(() => null);
        if (km?.killmail_time) {
          date = km.killmail_time.slice(0, 10);
          console.log(`[KILL API] Date recovered from cached killmail for ${id}: ${date}`);
        } else {

          if (isBot) {
            res.set('Cache-Control', 'public, max-age=300');
            return res.status(503).json({ error: 'Killmail not yet cached. Retry shortly.' });
          }
          try {
            const zkillRes = await axios.get(
              `https://zkillboard.com/api/killID/${id}/`,
              { timeout: 3000, headers: { 'User-Agent': 'Socket.Kill / Dexomus Viliana' } }
            );
            const zkbHash = zkillRes.data?.[0]?.zkb?.hash;
            if (!zkbHash) {
              return res.status(404).json({ Error: 'Kill not found in last 30 days or cache. Check Zkill URL' });
            }

            const km2 = await killmailCache.get(id, zkbHash);
            if (!km2?.killmail_time) {
              return res.status(404).json({ Error: 'Kill hash sourced but killmail unavailable.' });
            }

            date = km2.killmail_time.slice(0, 10);
            recoveredHash = zkbHash;
            console.log(`[KILL API] Failover recovered ${id} via zkill, date=${date}`);
          } catch (err) {
            console.warn(`[KILL API] Failover failed for ${id}: ${err.message}`);
            return res.status(404).json({ Error: 'Kill not found in last 30 days or cache. Check Zkill URL' });
          }
        }
      }
    }

    const isToday = date === new Date().toISOString().slice(0, 10);
    if (!isToday) {
      const cached = await r2.get(`kill-responses/${date}/${id}.json`).catch(() => null);
      if (cached) {
        res.set('Cache-Control', IMMUTABLE);
        const { ip, ua, ref } = requestMeta(req);
        console.log(`[KILL API] CACHE kill=${id} date=${date} ip=${ip} ua="${ua}" ref="${ref}"`);
        return res.json(cached);
      }
    }


    const { ip, ua, ref } = requestMeta(req);
    console.log(`[KILL API] kill=${id} date=${date} ip=${ip} ua="${ua}" ref="${ref}"`);

    try {
      const hash = recoveredHash || await hashCache.getHashFromShard(date, id);
      if (!hash) {
        return res.status(404).json({ error: `Kill ${id} not found in archive - CTRL + F5 incase not cached yet - for ${date}.` });
      }

      const killmail = await killmailCache.get(id, hash);
      if (!killmail) {
        return res.status(502).json({ error: 'Failed to fetch killmail - CTRL + F5 incase not cached yet.' });
      }

      const payload = await killmailResolver.resolveKillDetail(killmail, hash, id, esi);

      setCacheHeader(res, { isToday, todayMaxAge: 60 });
      res.json(payload);

      if (!isToday) {
        r2.put(`kill-responses/${date}/${id}.json`, payload).catch(err =>
          console.warn(`[KILL API] R2 cache write failed for ${id}: ${err.message}`));
      }

    } catch (err) {
      console.error(`[KILL API] Error resolving ${date}/${id}: ${err.message}`);
      res.status(500).json({ error: 'Internal error resolving killmail.' });
    }
  }

  app.get('/api/kill/:killID', handleKillDetail);
  app.get('/api/kill/:date/:killID', handleKillDetail);

  app.get('/api/kills/:date', async (req, res) => {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    if (BOT_UA.test(req.get('User-Agent') || '')) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.status(503).json({ error: 'Archive view unavailable to crawlers.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const isToday = date === today;
    console.log(`[LOG API] Request for ${date}${isToday ? ' (today)' : ''}`);

    try {
      let entries;
      if (isToday) {
        entries = hashCache.getAllToday();
      } else {
        const shard = await r2.get(`hashes/${date}.json`);
        entries = shard ? Object.entries(shard) : [];
      }

      if (!entries.length) {
        return res.json({ date, count: 0, total: 0, hasMore: false, hasPrev: false, kills: [], shipFilter: null });
      }

      const shipFilter = req.query.ship ? parseInt(req.query.ship) : null;

      if (shipFilter) {
        entries = entries.filter(([, value]) => {
          const shipID = typeof value === 'object' ? value.shipID : null;
          return shipID === shipFilter;
        });
      }

      const page = Math.max(1, parseInt(req.query.page) || 1);
      const PAGE_SIZE = 200;
      const start = (page - 1) * PAGE_SIZE;
      const end = start + PAGE_SIZE;

      const reversed = [...entries].reverse();
      const capped = reversed.slice(start, end);
      const hasMore = reversed.length > end;
      const hasPrev = page > 1;
      const limit = pLimit(5);

      const kills = await Promise.all(capped.map(([killID, value]) => limit(async () => {
        try {
          const hash = typeof value === 'object' ? value.hash : value;
          const km = await killmailCache.get(parseInt(killID), hash);
          if (!km) return null;
          return await killmailResolver.resolveKillSummary(km, killID, esi);
        } catch (err) {
          console.warn(`[LOG API] Failed kill ${killID}: ${err.message}`);
          return null;
        }
      })));

      const validKills = kills.filter(Boolean);

      setCacheHeader(res, { isToday, todayMaxAge: 30 });
      res.json({
        date,
        page,
        pageSize: PAGE_SIZE,
        count: validKills.length,
        total: entries.length,
        hasMore,
        hasPrev,
        shipFilter,
        kills: validKills,
      });

    } catch (err) {
      console.error(`[LOG API] Error for ${date}: ${err.message}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  const reactLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
    message: { error: 'Too many reactions — slow down.' },
  });

  app.post('/api/reactions/:killId', reactLimiter, (req, res) => {
    const id = parseInt(req.params.killId);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid killId' });

    const emoteKey = req.body?.emoteKey;
    if (typeof emoteKey !== 'string') return res.status(400).json({ error: 'Missing emoteKey' });

    const result = reactionsManager.react({ killmailId: id, emoteKey, ip: clientIp(req) });

    res.set('Cache-Control', 'no-store');
    res.json({
      killmailId: String(id),
      reactions: reactionsManager.get(id),
      accepted: result !== null,
    });
  });

  const SITE = 'https://socketkill.com';
  const SITEMAP_EPOCH = '2026-05-24';

  app.get('/sitemaps/kills-index.xml', (req, res) => {
    const days = [];
    const start = new Date(SITEMAP_EPOCH);
    for (let d = new Date(); d >= start; d.setDate(d.getDate() - 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${days.map(d => `  <sitemap><loc>${SITE}/sitemaps/kills/${d}.xml</loc><lastmod>${d}</lastmod></sitemap>`).join('\n')
      }\n</sitemapindex>`;
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  });

  app.get('/sitemaps/kills/:date.xml', async (req, res) => {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).send('Invalid date');
    const today = new Date().toISOString().slice(0, 10);
    const isToday = date === today;

    let ids;
    if (isToday) {
      ids = hashCache.getAllToday().map(([killID]) => killID);
    } else {
      const shard = await r2.get(`hashes/${date}.json`);
      ids = shard ? Object.keys(shard) : [];
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${ids.map(id => `  <url><loc>${SITE}/kill/${id}</loc><lastmod>${date}</lastmod></url>`).join('\n')
      }\n</urlset>`;
    res.set('Content-Type', 'application/xml');
    setCacheHeader(res, { isToday, todayMaxAge: 3600 });
    res.send(xml);
  });

  app.get('/api/search', searchLimiter, (req, res) => {
    const { parseIDList, parseSpaceList } = require('../core/apiHelpers');
    const WINDOWS = { '1h': 3.6e6, '6h': 2.16e7, '24h': 8.64e7 };
    const windowMs = WINDOWS[req.query.window] || null;
    const filters = {
      shipGroups: parseIDList(req.query.shipGroup),
      systems: parseIDList(req.query.system),
      regions: parseIDList(req.query.region),
      minTime: windowMs ? Date.now() - windowMs : 0,
      spaces: parseSpaceList(req.query.space),
      victimCorps: parseIDList(req.query.victimCorp),
      victimAlliances: parseIDList(req.query.victimAlliance),
      minValue: parseInt(req.query.minValue) || 0,
      maxValue: parseInt(req.query.maxValue) || Infinity,
      minAttackers: parseInt(req.query.minAttackers) || 0,
      maxAttackers: parseInt(req.query.maxAttackers) || Infinity,
      solo: req.query.solo === 'true',
    };

    const results = hashCache.search(filters);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const PAGE_SIZE = 50;
    const start = (page - 1) * PAGE_SIZE;
    const slice = results.slice(start, start + PAGE_SIZE);

    console.log(`[SEARCH] ip=${clientIp(req)} matches=${results.length} page=${page}`);

    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      total: results.length,
      page,
      pageSize: PAGE_SIZE,
      hasMore: results.length > start + PAGE_SIZE,
      hasPrev: page > 1,
      kills: slice,
    });
  });

  app.get('/api/stats', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
      totalScanned: statsManager.getTotal(),
      totalIsk: statsManager.totalIsk,
      connections: io.engine.clientsCount,
      uptime: process.uptime(),
      cache: {
        characters: esi.cache.characters.size,
        corporations: esi.cache.corporations.size,
        types: esi.cache.types.size,
        regions: esi.cache.regions.size
      },
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024)
      }
    });
  });

  app.get('/api/plex-rate', (req, res) => {
    const rate = plexRate.get();
    if (!rate) return res.status(503).json({ error: 'PLEX rate unavailable' });
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ gbpPerIsk: rate.gbpPerIsk });
  });

  app.get('/api/top10', async (req, res) => {
    try {
      const cutoff = Date.now() - 60 * 60 * 1000;
      const entries = hashCache.search({}).filter(e => {
        const t = e.time ? new Date(e.time).getTime() : 0;
        return t >= cutoff;
      });

      const tally = (list, keyFn) => {
        const m = new Map();
        for (const e of list) {
          const k = keyFn(e);
          if (k == null) continue;
          m.set(k, (m.get(k) || 0) + 1);
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      };
      const idCount = (pairs) => pairs.map(([id, count]) => ({ id: Number(id), count }));
      const resolveNames = (pairs, fn) =>
        Promise.all(pairs.map(([id]) => fn(Number(id)).catch(() => null)))
          .then(names => pairs.map(([id, count], i) => ({ id: Number(id), name: names[i], count })));

      const corpNames = new Map();
      for (const e of entries) if (e.victimCorpID && e.corpName) corpNames.set(e.victimCorpID, e.corpName);
      const victimCorp = tally(entries, e => e.victimCorpID)
        .map(([id, count]) => ({ id: Number(id), name: corpNames.get(Number(id)) ?? null, count }));
      const victimAlliance = await resolveNames(tally(entries, e => e.victimAllianceID), id => esi.getAllianceName(id));
      const killers = entries.filter(e => !e.finalBlowIsNpc);
      const killerCorp = await resolveNames(tally(killers, e => e.finalBlowCorpID), id => esi.getCorporationName(id));
      const killerAlliance = await resolveNames(tally(killers, e => e.finalBlowAllianceID), id => esi.getAllianceName(id));

      const topValue = [...entries]
        .sort((a, b) => (b.totalValue || 0) - (a.totalValue || 0))
        .slice(0, 10)
        .map(e => ({ killID: e.killID, value: e.totalValue || 0, shipID: e.shipID ?? null, victimName: e.victimName ?? null, systemID: e.systemID ?? null }));

      res.set('Cache-Control', 'public, max-age=60');
      res.json({
        window: '1h',
        generatedAt: new Date().toISOString(),
        sampleSize: entries.length,
        ships: idCount(tally(entries, e => e.shipID)),
        shipGroups: idCount(tally(entries, e => e.shipGroupID)),
        systems: idCount(tally(entries, e => e.systemID)),
        regions: idCount(tally(entries, e => e.regionID)),
        victimCorp,
        victimAlliance,
        finalBlowWeapon: idCount(tally(killers, e => e.finalBlowWeaponID)),
        killerShip: idCount(tally(killers, e => e.finalBlowShipID)),
        killerCorp,
        killerAlliance,
        topValue,
      });
    } catch (err) {
      console.error('[TOP10] error:', err.message);
      res.status(500).json({ error: 'Internal error' });
    }
  });
  app.get('/api/filter-source', async (req, res) => {
    try {
      const [systems, regions, groups, ships, items, meta] = await Promise.all([
        kvClient.get('sde:systems'),
        kvClient.get('sde:regions'),
        kvClient.get('sde:groups'),
        kvClient.get('sde:ships'),
        kvClient.get('sde:items'),
        kvClient.get('sde:meta'),
      ]);

      const missing = {
        systems: !systems,
        regions: !regions,
        groups: !groups,
        ships: !ships,
        items: !items,
      };
      if (Object.values(missing).some(Boolean)) {
        return res.status(503).json({ error: 'Filter source incomplete', missing });
      }

      const etag = meta?.buildNumber ? `"sde-${meta.buildNumber}"` : null;

      if (etag && req.headers['if-none-match'] === etag) {
        res.set('ETag', etag);
        return res.status(304).end();
      }

      res.set('Cache-Control', 'public, max-age=3600, must-revalidate');
      if (etag) res.set('ETag', etag);

      res.json({
        buildNumber: meta?.buildNumber ?? null,
        syncedAt: meta?.lastSyncedAt ?? null,
        systems,
        regions,
        groups,
        ships,
        items,
      });
    } catch (err) {
      console.error('[filter-source] error:', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.get('/api/reactions/:killId', (req, res) => {
    const id = parseInt(req.params.killId);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid killId' });
    res.set('Cache-Control', 'no-store');
    res.json({ killmailId: String(id), reactions: reactionsManager.get(id) });
  });

  app.get('/api/refire/:killId', async (req, res) => {
    const processor = getProcessor();
    if (!processor) {
      console.warn('[REFIRE] Processor not ready');
      return res.status(503).json({ error: 'Processor not ready' });
    }
    try {
      const killId = req.params.killId;
      console.log(`[REFIRE] Requested kill ${killId}`);

      const zkillRes = await axios.get(
        `https://zkillboard.com/api/killID/${killId}/`,
        { headers: { 'User-Agent': 'Socket.Kill / Dexomus Viliana' } }
      );
      const zkillData = zkillRes.data[0];
      if (!zkillData) {
        console.warn(`[REFIRE] Kill ${killId} not found on zkill`);
        return res.status(404).json({ error: 'Kill not found' });
      }

      const hash = zkillData.zkb?.hash;
      const totalValue = zkillData.zkb?.totalValue || 0;
      console.log(`[REFIRE] Kill ${killId} | Hash: ${hash} | Value: ${totalValue}`);

      const esiRes = await axios.get(
        `https://esi.evetech.net/latest/killmails/${killId}/${hash}/`,
        { headers: { 'X-Compatibility-Date': '2025-12-16' } }
      );
      console.log(`[REFIRE] ESI data fetched for kill ${killId}`);

      const r2Package = {
        killID: parseInt(killId),
        zkb: zkillData.zkb,
        isR2: true,
        esiData: esiRes.data
      };

      processor.processPackage(r2Package);
      console.log(`[REFIRE] Kill ${killId} fired through processor`);
      res.json({ success: true, killId, totalValue });
    } catch (err) {
      console.error(`[REFIRE] Failed for kill ${req.params.killId}: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.use(express.static(path.join(__dirname, "..", "..", "public")));

  app.get("/", (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });

  io.on("connection", (socket) => {
    console.log(`Client connected to Web Socket Stream: ${socket.id}`);

    const charParam = socket.handshake.query.character;
    if (charParam) {
      const charId = parseInt(charParam);
      if (Number.isFinite(charId) && charId > 0) {
        socket.join(`char:${charId}`);
        console.log(`[TICKER] ${socket.id} joined char:${charId}`);
      }
    }
    let lastReact = 0;
    const REACT_MIN_INTERVAL_MS = 500;

    socket.on("react", (payload) => {
      const now = Date.now();
      if (now - lastReact < REACT_MIN_INTERVAL_MS) return;
      lastReact = now;

      const killmailId = parseInt(payload?.killmailId);
      const emoteKey = payload?.emoteKey;
      if (!Number.isFinite(killmailId) || killmailId <= 0) return;
      if (typeof emoteKey !== 'string') return;

      const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || socket.handshake.address;

      const result = reactionsManager.react({ killmailId, emoteKey, ip });
      if (result) io.emit("reaction-update", result);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[NETWORK] Client disconnected: ${socket.id} | Reason: ${reason} | Active: ${io.engine.clientsCount}`);
    });
  });

  plexRate.refresh().catch((e) => console.error('[PLEX] init failed:', e.message));
  setInterval(
    () => plexRate.refresh().catch((e) => console.error('[PLEX] refresh failed:', e.message)),
    12 * 60 * 60 * 1000
  );
  server
    .listen(PORT, () => {
      console.log(`Web Module Loaded on ${PORT}`);
    })
    .on("error", (err) => { });

  return { app, io };
}

module.exports = startWebServer;
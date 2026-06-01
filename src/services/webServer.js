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
const searchIndex = require('../state/searchIndex');

function startWebServer(esi, statsManager, sharedState, getProcessor) {
  const app = express();

  const options = {
    key: fs.readFileSync(
      path.join(__dirname, "..", "..", "ssl", "socketkillcom.key"),
    ),
    cert: fs.readFileSync(
      path.join(__dirname, "..", "..", "ssl", "socketkillcom.pem"),
    ),
  };

  const server = https.createServer(options, app);

 
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(cors());
  app.use(express.json());

  const io = new Server(server, {
    pingTimeout: 20000,
    pingInterval: 25000,
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
        "https://test-enviroment-4b4.pages.dev",
        "https://socket-kill-front-end.pages.dev",
        "http://localhost:4321",
        "http://localhost:5173",
        "https://socketkill-v2.themadlyscientific.workers.dev",
        "https://beta.socketkill.com"
      ], // Web Socket whitelist
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  const PORT = process.env.PORT;
  const publicPath = path.join(__dirname, "..", "..", "public");

  async function fetchZkbMeta(killID) {
    try {
      const res = await axios.get(`https://zkillboard.com/api/killID/${killID}/`, {
        timeout: 3000,
        headers: { 'User-Agent': 'Socket.Kill / Dexomus Viliana' }
      });
      const entry = res.data?.[0];
      return entry?.zkb || null;
    } catch (err) {
      console.warn(`[ZKB FETCH] ${killID} failed: ${err.message}`);
      return null;
    }
  }

  app.get("/api/character/:id", async (req, res) => {
    console.log(`[API] Character lookup: ${req.params.id}`);
    try {
      const { id } = req.params;
      const name = await esi.getCharacterName(id);
      res.json({
        id,
        name,
        portraitUrl: `https://images.evetech.net/characters/${id}/portrait?size=256`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function parseIDList(value) {
  if (!value) return [];
  return String(value).split(',').map(v => parseInt(v.trim(), 10)).filter(Number.isFinite);
}

function parseSpaceList(value) {
  if (!value) return [];
  const valid = new Set(['high', 'low', 'null', 'wh', 'pochven', 'unknown']);
  return String(value).split(',').map(v => v.trim().toLowerCase()).filter(v => valid.has(v));
}

function matchesFilters(entry, f) {
  if (f.shipTypeIDs.length && !f.shipTypeIDs.includes(entry.shipID)) return false;
  if (f.shipGroupIDs.length && !f.shipGroupIDs.includes(entry.shipGroupID)) return false;
  if (f.systemIDs.length && !f.systemIDs.includes(entry.systemID)) return false;
  if (f.regionIDs.length && !f.regionIDs.includes(entry.regionID)) return false;
  if (f.space.length && !f.space.includes(entry.space)) return false;
  if (f.minValue !== null && (entry.totalValue ?? 0) < f.minValue) return false;
  if (f.maxValue !== null && (entry.totalValue ?? 0) > f.maxValue) return false;
  if (f.minAttackers !== null && (entry.attackerCount ?? 0) < f.minAttackers) return false;
  if (f.maxAttackers !== null && (entry.attackerCount ?? 0) > f.maxAttackers) return false;
  if (f.solo && entry.attackerCount !== 1) return false;
  if (f.victimCorpIDs.length && !f.victimCorpIDs.includes(entry.victimCorpID)) return false;
  if (f.victimAllianceIDs.length && !f.victimAllianceIDs.includes(entry.victimAllianceID)) return false;
  if (f.attackerCorpIDs.length && !(entry.attackerCorpIDs ?? []).some(id => f.attackerCorpIDs.includes(id))) return false;
  if (f.attackerAllianceIDs.length && !(entry.attackerAllianceIDs ?? []).some(id => f.attackerAllianceIDs.includes(id))) return false;
  return true;
}

// //app.get('/api/kills/search', async (req, res) => {
//   try {
//     const date = req.query.date || todayUTC();
//     if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
//       return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
//     }

//     const filters = {
//       shipTypeIDs: parseIDList(req.query.shipType),
//       shipGroupIDs: parseIDList(req.query.shipGroup),
//       systemIDs: parseIDList(req.query.system),
//       regionIDs: parseIDList(req.query.region),
//       space: parseSpaceList(req.query.space),
//       minValue: req.query.minIsk ? parseInt(req.query.minIsk, 10) : null,
//       maxValue: req.query.maxIsk ? parseInt(req.query.maxIsk, 10) : null,
//       minAttackers: req.query.minAttackers ? parseInt(req.query.minAttackers, 10) : null,
//       maxAttackers: req.query.maxAttackers ? parseInt(req.query.maxAttackers, 10) : null,
//       victimCorpIDs: parseIDList(req.query.victimCorp),
//       victimAllianceIDs: parseIDList(req.query.victimAlliance),
//       attackerCorpIDs: parseIDList(req.query.attackerCorp),
//       attackerAllianceIDs: parseIDList(req.query.attackerAlliance),
//       solo: req.query.solo === '1',
//     };

//     const shard = await searchIndex.getShard(date);
//     let entries = Object.entries(shard);

//     // Cheap filter pass on shard data — no killmail loads
//     entries = entries.filter(([, entry]) => matchesFilters(entry, filters));

//     // Sort by timestamp desc by default
//     entries.sort((a, b) => (b[1].timestamp ?? 0) - (a[1].timestamp ?? 0));

//     const total = entries.length;
//     const page = Math.max(1, parseInt(req.query.page, 10) || 1);
//     const PAGE_SIZE = 50;
//     const start = (page - 1) * PAGE_SIZE;
//     const pageSlice = entries.slice(start, start + PAGE_SIZE);

//     // Load + enrich killmails for this page only
//     const limit = pLimit(5);
//     const kills = await Promise.all(pageSlice.map(([killID, entry]) => limit(async () => {
//       try {
//         const hash = await hashCache.getHashFromShard(date, parseInt(killID, 10));
//         if (!hash) return null;

//         const km = await killmailCache.get(parseInt(killID, 10), hash);
//         if (!km) return null;

//         const victim = km.victim;
//         const sys = esi.getSystemDetails(km.solar_system_id);
//         const finalBlow = km.attackers?.find(a => a.final_blow) || km.attackers?.[0];

//         const [vName, vCorp, vAlliance, vShip, region, fbCorp] = await Promise.all([
//           esi.getCharacterName(victim.character_id),
//           esi.getCorporationName(victim.corporation_id),
//           victim.alliance_id ? esi.getAllianceName(victim.alliance_id) : Promise.resolve(null),
//           esi.getTypeName(victim.ship_type_id),
//           sys?.region_id ? esi.getRegionName(sys.region_id) : Promise.resolve('K-Space'),
//           finalBlow?.corporation_id ? esi.getCorporationName(finalBlow.corporation_id) : Promise.resolve('Unknown'),
//         ]);

//         return {
//           killID: parseInt(killID, 10),
//           time: km.killmail_time,
//           rawValue: entry.totalValue,
//           formattedValue: helpers.formatIsk(entry.totalValue),
//           victim: {
//             name: (vName === 'Unknown' || !vName) ? vCorp : vName,
//             characterID: victim.character_id || null,
//             corp: vCorp,
//             corporationID: victim.corporation_id || null,
//             alliance: vAlliance,
//             allianceID: victim.alliance_id || null,
//             ship: vShip,
//             shipTypeID: victim.ship_type_id,
//           },
//           system: {
//             id: km.solar_system_id,
//             name: sys?.name || 'Unknown',
//             region,
//             regionID: sys?.region_id,
//             security: sys?.security_status,
//             space: entry.space,
//           },
//           finalBlowCorp: fbCorp,
//           attackerCount: km.attackers?.length || 0,
//         };
//       } catch (err) {
//         console.warn(`[SEARCH API] Failed kill ${killID}: ${err.message}`);
//         return null;
//       }
// //     })));

//     const validKills = kills.filter(Boolean);

//     const isToday = date === todayUTC();
//     res.set('Cache-Control', isToday ? 'public, max-age=30' : 'public, max-age=300');

//     res.json({
//       date,
//       filters,
//       page,
//       pageSize: PAGE_SIZE,
//       total,
//       count: validKills.length,
//       hasMore: total > start + PAGE_SIZE,
//       hasPrev: page > 1,
//       kills: validKills,
//     });

//   } catch (err) {
//     console.error('[SEARCH API] Error:', err);
//     res.status(500).json({ error: 'Internal error' });
//   }
// //});

  async function handleKillDetail(req, res) {
    let date, id;

    if (req.params.date) {
      date = req.params.date;
      id = parseInt(req.params.killID);
    } else {
      id = parseInt(req.params.killID);
      const now = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
        if (await hashCache.getHashFromShard(d, id)) {
          date = d;
          break;
        }
      }
      if (!date) return res.status(404).json({ error: 'Kill not found' });
    }

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid killID.' });
    }

    const ua = (req.get('user-agent') || '').slice(0, 80);
    console.log(`[KILL API] Request for kill ${id}${date ? ` (date: ${date})` : ''} | UA: ${ua}`);
    try {
    
      const hash = await hashCache.getHashFromShard(date, id);
      if (!hash) {
        return res.status(404).json({ error: `Kill ${id} not found in archive - CTRL + F5 incase not cached yet - for ${date}.` });
      }

  
      const killmail = await killmailCache.get(id, hash);
      if (!killmail) {
        return res.status(502).json({ error: 'Failed to fetch killmail - CTRL + F5 incase not cached yet.' });
      }

      const victim = killmail.victim;
      const finalBlow = killmail.attackers.find(a => a.final_blow) || killmail.attackers[0];
      const systemDetails = esi.getSystemDetails(killmail.solar_system_id);

      const [
        victimName, victimCorp, victimAlliance, victimShip,
        finalBlowName, finalBlowCorp, finalBlowShip,
        regionName, zkb, items,
        ...attackerData
      ] = await Promise.all([
        esi.getCharacterName(victim.character_id),
        esi.getCorporationName(victim.corporation_id),
        victim.alliance_id ? esi.getAllianceName(victim.alliance_id) : Promise.resolve(null),
        esi.getTypeName(victim.ship_type_id),
        esi.getCharacterName(finalBlow.character_id),
        esi.getCorporationName(finalBlow.corporation_id),
        esi.getTypeName(finalBlow.ship_type_id),
        systemDetails?.region_id ? esi.getRegionName(systemDetails.region_id) : Promise.resolve('K-Space'),
        fetchZkbMeta(id),
        resolveItems(victim.items, esi),
        ...killmail.attackers.flatMap(a => [
          esi.getCharacterName(a.character_id),
          esi.getCorporationName(a.corporation_id),
          esi.getTypeName(a.ship_type_id),
        ])
      ]);

      const damageTaken = victim.damage_taken || 0;

      const attackers = killmail.attackers.map((a, i) => ({
        name: attackerData[i * 3],
        characterID: a.character_id || null,
        corp: attackerData[i * 3 + 1],
        corporationID: a.corporation_id || null,
        allianceID: a.alliance_id || null,
        ship: attackerData[i * 3 + 2],
        shipTypeID: a.ship_type_id || null,
        damage: a.damage_done,
        damagePercent: damageTaken > 0
          ? Math.round((a.damage_done / damageTaken) * 1000) / 10
          : 0,
        finalBlow: !!a.final_blow
      }));

      const payload = {
        killID: id,
        killmailHash: hash,
        killmailTime: killmail.killmail_time,
        rawValue: zkb?.totalValue || 0,
        totalValue: zkb?.totalValue ? helpers.formatIsk(zkb.totalValue) : null,
        droppedValue: zkb?.droppedValue ? helpers.formatIsk(zkb.droppedValue) : null,
        destroyedValue: zkb?.destroyedValue ? helpers.formatIsk(zkb.destroyedValue) : null,
        fittedValue: zkb?.fittedValue ? helpers.formatIsk(zkb.fittedValue) : null,
        items,
        victim: {
          name: (victimName === "Unknown" || !victimName) ? victimCorp : victimName,
          characterID: victim.character_id,
          corp: victimCorp,
          corporationID: victim.corporation_id,
          alliance: victimAlliance,
          allianceID: victim.alliance_id || null,
          ship: victimShip,
          shipTypeID: victim.ship_type_id,
          damageTaken: victim.damage_taken
        },
        system: {
          id: killmail.solar_system_id,
          name: systemDetails?.name || 'Unknown System',
          region: regionName,
          regionID: systemDetails?.region_id,
          security: systemDetails?.security_status
        },
        finalBlow: {
          name: finalBlowName,
          characterID: finalBlow.character_id || null,
          corp: finalBlowCorp,
          corporationID: finalBlow.corporation_id || null,
          ship: finalBlowShip,
          shipTypeID: finalBlow.ship_type_id || null,
        },
        attackers,
        attackerCount: attackers.length
      };

      
      const isToday = date === new Date().toISOString().slice(0, 10);
      res.set('Cache-Control', isToday
        ? 'public, max-age=60'
        : 'public, max-age=31536000, immutable');
      res.json(payload);

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

    const today = new Date().toISOString().slice(0, 10);
    const isToday = date === today;
    const r2 = require('../network/r2Writer');
    const { calculateKillValue } = require('./priceService');

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
      const kills = await Promise.all(capped.map(async ([killID, value]) => limit(async () => {
        try {
          const hash = typeof value === 'object' ? value.hash : value;
          const km = await killmailCache.get(parseInt(killID), hash);
          if (!km) return null;

          const victim = km.victim;
          const sys = esi.getSystemDetails(km.solar_system_id);
          const finalBlow = km.attackers?.find(a => a.final_blow) || km.attackers?.[0];

          const [vName, vCorp, vAlliance, vShip, region, fbCorp] = await Promise.all([
            esi.getCharacterName(victim.character_id),
            esi.getCorporationName(victim.corporation_id),
            victim.alliance_id ? esi.getAllianceName(victim.alliance_id) : Promise.resolve(null),
            esi.getTypeName(victim.ship_type_id),
            sys?.region_id ? esi.getRegionName(sys.region_id) : Promise.resolve('K-Space'),
            finalBlow?.corporation_id ? esi.getCorporationName(finalBlow.corporation_id) : Promise.resolve('Unknown'),
          ]);

          const rawValue = calculateKillValue(km);

          return {
            killID: parseInt(killID),
            time: km.killmail_time,
            rawValue,
            formattedValue: helpers.formatIsk(rawValue),
            victim: {
              name: (vName === 'Unknown' || !vName) ? vCorp : vName,
              characterID: victim.character_id || null,
              corp: vCorp,
              corporationID: victim.corporation_id || null,
              alliance: vAlliance,
              allianceID: victim.alliance_id || null,
              ship: vShip,
              shipTypeID: victim.ship_type_id,
            },
            system: {
              id: km.solar_system_id,
              name: sys?.name || 'Unknown',
              region,
              regionID: sys?.region_id,
              security: sys?.security_status,
            },
            finalBlowCorp: fbCorp,
            attackerCount: km.attackers?.length || 0,
          };
        } catch (err) {
          console.warn(`[LOG API] Failed kill ${killID}: ${err.message}`);
          return null;
        }
      })));

      const validKills = kills.filter(Boolean);

      res.set('Cache-Control', isToday
        ? 'public, max-age=30'
        : 'public, max-age=31536000, immutable');

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
        { headers: { 'User-Agent': 'Socket.Kill - dev@socketkill.com' } }
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
    socket.on("disconnect", (reason) => {
      console.log(`[NETWORK] Client disconnected: ${socket.id} | Reason: ${reason} | Active: ${io.engine.clientsCount}`);
    });
  });

  server
    .listen(PORT, () => {
      console.log(`Web Module Loaded on ${PORT}`);
    })
    .on("error", (err) => { });

  return { app, io };
}

module.exports = startWebServer;
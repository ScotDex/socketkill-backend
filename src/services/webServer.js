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

  // 1. SECURITY & PARSING MIDDLEWARE
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
        "https://socketkill.com/about/"
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

    console.log(`[KILL API] Request for kill ${id}${date ? ` (date: ${date})` : ''}`);
    try {
      // 1. Hash lookup
      const hash = await hashCache.getHashFromShard(date, id);
      if (!hash) {
        return res.status(404).json({ error: `Kill ${id} not found in archive - CTRL + F5 incase not cached yet - for ${date}.` });
      }

      // 2. Killmail fetch
      const killmail = await killmailCache.get(id, hash);
      if (!killmail) {
        return res.status(502).json({ error: 'Failed to fetch killmail - CTRL + F5 incase not cached yet.' });
      }

      // 3. Resolve names
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

      // 4. Build response
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

      // 5. Cache headers
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

  // 3. STATIC FILES & ROOT (Last priority)
  app.use(express.static(path.join(__dirname, "..", "..", "public")));

  app.get("/", (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });

  // 4. SOCKET LOGIC
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
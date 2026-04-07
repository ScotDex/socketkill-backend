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
const { renderKillPage } = require("./killPageRenderer");

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
        "https://heatmap.socketkill.com",
        "https://incursions-dev.nesbit.solutions",
        "https://incursions.nesbit.solutions"
      ], // Web Socket whitelist
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  const PORT = process.env.PORT;
  const publicPath = path.join(__dirname, "..", "..", "public");

  // 2. API ROUTES (Must be defined before Static/Catch-all)
  app.get("/api/character/search/:name", async (req, res) => {
    console.log(`[API] Character search: ${req.params.name}`);
    try {
      const id = await esi.getCharacterID(req.params.name);
      if (!id) return res.status(404).json({ error: "Character not found" });
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

  app.get("/api/corporation/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const name = await esi.getCorporationName(id);
      res.json({
        id,
        name,
        logoUrl: `https://images.evetech.net/corporations/${id}/logo?size=128`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
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
            zkb: { totalValue, href: null },
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

// Kill detail page — date-dispatched hash lookup, ESI fetch, HTML render
app.get('/kill/:date/:killID', async (req, res) => {
    const { date, killID } = req.params;

    // Input validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).send('Invalid date format. Expected YYYY-MM-DD.');
    }
    const id = parseInt(killID);
    if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).send('Invalid killID.');
    }

    try {
        // 1. Hash lookup — date dispatches the source (memory for today, R2 shard for older)
        const hash = await hashCache.getHashFromShard(date, id);
        if (!hash) {
            console.warn(`[KILLPAGE] No hash found for ${date}/${id}`);
            return res.status(404).send(`Kill ${id} not found in Socket.Kill archive for ${date}.`);
        }

        // 2. Killmail fetch (LRU + dedup handled inside)
        const killmail = await killmailCache.get(id, hash);
        if (!killmail) {
            return res.status(502).send('Failed to fetch killmail from ESI.');
        }

        // 3. Resolve names via existing ESIClient (mostly cache hits)
        const victim = killmail.victim;
        const finalBlow = killmail.attackers.find(a => a.final_blow) || killmail.attackers[0];
        const systemDetails = esi.getSystemDetails(killmail.solar_system_id);

        const [
            victimName, victimCorp, victimShip,
            finalBlowName, finalBlowCorp, finalBlowShip,
            regionName,
            ...attackerData
        ] = await Promise.all([
            esi.getCharacterName(victim.character_id),
            esi.getCorporationName(victim.corporation_id),
            esi.getTypeName(victim.ship_type_id),
            esi.getCharacterName(finalBlow.character_id),
            esi.getCorporationName(finalBlow.corporation_id),
            esi.getTypeName(finalBlow.ship_type_id),
            systemDetails?.region_id ? esi.getRegionName(systemDetails.region_id) : Promise.resolve('K-Space'),
            ...killmail.attackers.flatMap(a => [
                esi.getCharacterName(a.character_id),
                esi.getCorporationName(a.corporation_id),
                esi.getTypeName(a.ship_type_id),
            ])
        ]);

        const attackers = killmail.attackers.map((a, i) => ({
            name: attackerData[i * 3],
            corp: attackerData[i * 3 + 1],
            ship: attackerData[i * 3 + 2],
            damage: a.damage_done,
        }));

        // 4. Render HTML
        const html = renderKillPage({
            killID: id,
            killmail,
            resolved: {
                victimName, victimCorp, victimShip,
                systemName: systemDetails?.name || 'Unknown System',
                regionName,
                security: systemDetails?.security_status,
                finalBlowName, finalBlowCorp, finalBlowShip,
                attackers,
            },
        });

        // 5. Cache headers — sealed days are immutable, today is short-lived
        const isToday = date === new Date().toISOString().slice(0, 10);
        res.set('Cache-Control', isToday
            ? 'public, max-age=60'
            : 'public, max-age=31536000, immutable');
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (err) {
        console.error(`[KILLPAGE] Error rendering ${date}/${id}: ${err.message}`);
        res.status(500).send('Internal error rendering kill page.');
    }
});

  // 3. STATIC FILES & ROOT (Last priority)
  app.use(express.static(path.join(__dirname, "..", "..", "public")));

  app.get("/", (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });

  // 4. SOCKET LOGIC
  io.on("connection", (socket) => {
    console.log(`Client connected to Intel Stream: ${socket.id}`);
    socket.on("disconnect", () => console.log("Client disconnected"));
  });

  server
    .listen(PORT, () => {
      console.log(`Web Module Loaded on ${PORT}`);
    })
    .on("error", (err) => {});

  return { app, io };
}

module.exports = startWebServer;
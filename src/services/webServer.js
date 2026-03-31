require("dotenv").config();
const express = require("express");
const https = require("https");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const fs = require("fs");
const axios = require("../network/agent");

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
        "https://front-end-test.pages.dev",
        "https://ws.socketkill.com",
        "https://heatmap.socketkill.com",
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
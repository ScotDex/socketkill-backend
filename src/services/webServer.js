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
        "https://ws.socketkill.com"
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
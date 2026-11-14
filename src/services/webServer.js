require("dotenv").config({ quiet: true });

// Node Modules
const fs = require("fs");
const https = require("https");
const path = require("path");

// Packages
const cors = require("cors");
const express = require("express");
const pLimit = require("p-limit");
const { Server } = require("socket.io");
const helmet = require("helmet");

// Imports
const hashCache = require("../state/hashCache");
const killmailCache = require("../state/killmailCache");
const killmailResolver = require("../core/killmailResolver");
const killLocator = require("../core/killLocator");
const coldGate = require("../middleware/lookupGate");
const zkillLimit = require("../middleware/zkillLimit");
const turnstile = require("../middleware/turnstile");
const {
  requestMeta,
  setCacheHeader,
  IMMUTABLE,
} = require("../core/requestMeta");
const r2 = require("../network/r2Writer");
const plexRate = require("../services/plexRate");
const npcKills = require("./npcKills");
const hashIndex = require("../state/hashIndex");
const helpers = require("../core/helpers");
const { WHALE_THRESHOLD } = require("../services/whaleModule");

// Configuration
const PORT = process.env.PORT;
const WORKER_IP = "2a06:98c0:3600::103";
const ROOT = path.join(__dirname, "..", "..");
const SSL_DIR = path.join(ROOT, "ssl");
const PUBLIC_DIR = path.join(ROOT, "public");
const SOCKET_ORIGINS = [
  "https://socketkill.com",
  "https://pf.darkventure.space",
  "https://ws.socketkill.com",
  "https://incursions-dev.nesbit.solutions",
  "https://incursions.nesbit.solutions",
];
const KILLS_PAGE_SIZE = 200;
const KILLS_CONCURRENCY = 5;
const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers (need nothing from inside startWebServer)
// ---------------------------------------------------------------------------

// Logs direct (non-Worker) hits and Turnstile retries on the kill API.
function logKillEntry(req, id, isBot) {
  const { ip, ua } = requestMeta(req);
  const real = req.get("CF-Connecting-IP") || "-";
  const claimed = req.get("X-SK-Client-IP");
  const via = real === WORKER_IP ? "worker" : "direct";
  const spoof = via === "direct" && claimed ? ` SPOOF=${claimed}` : "";
  if (via === "direct" || req.get("X-SK-Turnstile")) {
    console.log(
      `[KILL API] ENTRY kill=${id}${isBot ? " BOT" : ""} ip=${ip} via=${via}${spoof} ua="${ua}"`,
    );
  }
}

// Wraps a handler so cold (expensive) requests must take a gate slot first.
// isHot(req) returning true skips the gate.
function withColdGate(handler, isHot) {
  return async function (req, res) {
    if (isHot(req)) return handler(req, res);
    const release = coldGate.acquire(req, res);
    if (!release) return;
    try {
      await handler(req, res);
    } finally {
      release();
    }
  };
}

// Hot = the kill is in today's in-memory cache.
function isHotKill(req) {
  const id = parseInt(req.params.killID);
  return Number.isFinite(id) && Boolean(hashCache.get(id));
}

// Hot = the request is for today's kill log.
function isTodayLog(req) {
  return req.params.date === helpers.todayUTC();
}

// Joins a socket to `${room}:${id}` when the handshake query has a valid
// positive number under `param`.
function joinNumericRoom(socket, param, room, tag) {
  const raw = socket.handshake.query[param];
  if (!raw) return;
  const id = parseInt(raw);
  if (Number.isFinite(id) && id > 0) {
    socket.join(`${room}:${id}`);
    console.log(`[${tag}] ${socket.id} joined ${room}:${id}`);
  }
}

// Runs service.refresh() now, then again every intervalMs.
function startRefresh(tag, service, intervalMs) {
  service
    .refresh()
    .catch((e) => console.error(`[${tag}] init failed:`, e.message));
  setInterval(
    () =>
      service
        .refresh()
        .catch((e) => console.error(`[${tag}] refresh failed:`, e.message)),
    intervalMs,
  );
}

// ---------------------------------------------------------------------------
// Web server
// ---------------------------------------------------------------------------

function startWebServer(esi, statsManager, sharedState, getProcessor) {
  // Express app + global middleware
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());

  // HTTPS server
  const server = https.createServer(
    {
      key: fs.readFileSync(path.join(SSL_DIR, "socketkillcom.key")),
      cert: fs.readFileSync(path.join(SSL_DIR, "socketkillcom.pem")),
    },
    app,
  );

  // Socket.IO
  const io = new Server(server, {
    pingTimeout: 3000,
    pingInterval: 5000,
    cors: { origin: SOCKET_ORIGINS, methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
  });

  // Feature routes that need the socket server
  app.use(require("./overlayRoutes")(io));
  app.use(require("./ytRoutes")(io));

  app.use(express.json());

  // -------------------------------------------------------------------------
  // GET /api/kill/:killID  and  /api/kill/:date/:killID
  // -------------------------------------------------------------------------
  async function handleKillDetail(req, res) {
    const id = parseInt(req.params.killID);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid killID." });
    }

    const isBot = helpers.isBot(req);
    logKillEntry(req, id, isBot);

    // Gate: bots only get whale kills
    if (isBot && !(await hashCache.isWhale(id, WHALE_THRESHOLD))) {
      console.warn(`[KILL API] BOT GATE kill=${id}`);
      res.set("Cache-Control", "no-store");
      return res.status(410).json({ error: "Unavailable" });
    }

    // Locate: date from the URL, otherwise look locally
    let located = req.params.date
      ? { date: req.params.date, hash: null }
      : await killLocator.findKillLocally(id);

    // Failover: not known locally, so gate it, then ask zKill.
    // Order matters: bot check -> Turnstile -> rate limit -> zKill.
    if (!located) {
      if (isBot) {
        console.warn(`[KILL API] BOT GATE kill=${id} no date`);
        return res.status(410).json({ error: "Unavailable" });
      }

      const tsOk = await turnstile.verify(req.get("X-SK-Turnstile"));
      if (!tsOk) {
        res.set("Cache-Control", "no-store");
        return res.status(428).json({ error: "Challenge required." });
      }

      if (!zkillLimit.tryTake()) {
        console.warn(`[KILL API] FAILOVER LIMIT kill=${id}`);
        res.set("Cache-Control", "no-store");
        res.set("Retry-After", "30");
        return res.status(503).json({ error: "Archive busy — retry shortly." });
      }

      located = await killLocator.recoverFromZkill(id);
      if (located.error) {
        return res.status(404).json({ Error: located.error });
      }
    }

    const { date, hash: recoveredHash } = located;

    // Serve a stored response for past days if we have one
    const isToday = date === helpers.todayUTC();
    if (!isToday) {
      const cached = await r2
        .get(`kill-responses/${date}/${id}.json`)
        .catch(() => null);
      if (cached) {
        res.set("Cache-Control", IMMUTABLE);
        console.log(`[KILL API] CACHE kill=${id} date=${date}`);
        return res.json(cached);
      }
    }

    // Resolve and send
    try {
      const hash =
        recoveredHash ||
        (await hashIndex.getHashById(id)) ||
        (await hashCache.getHashFromShard(date, id));
      if (!hash) {
        return res.status(404).json({
          error: `Kill ${id} not found in archive - CTRL + F5 incase not cached yet - for ${date}.`,
        });
      }

      const killmail = await killmailCache.get(id, hash);
      if (!killmail) {
        return res.status(502).json({
          error: "Failed to fetch killmail - CTRL + F5 incase not cached yet.",
        });
      }

      const payload = await killmailResolver.resolveKillDetail(
        killmail,
        hash,
        id,
        esi,
      );

      setCacheHeader(res, { isToday, todayMaxAge: 60 });
      res.json(payload);
    } catch (err) {
      console.error(`[KILL API] Error resolving ${date}/${id}: ${err.message}`);
      res.status(500).json({ error: "Internal error resolving killmail." });
    }
  }

  // -------------------------------------------------------------------------
  // GET /api/kills/:date
  // -------------------------------------------------------------------------

  // Turns one [killID, value] shard entry into a kill summary, or null.
  async function summariseKill([killID, value]) {
    try {
      const hash = typeof value === "object" ? value.hash : value;
      const km = await killmailCache.get(parseInt(killID), hash);
      if (!km) return null;
      return await killmailResolver.resolveKillSummary(km, killID, esi);
    } catch (err) {
      console.warn(`[LOG API] Failed kill ${killID}: ${err.message}`);
      return null;
    }
  }

  async function handleKillsByDate(req, res) {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res
        .status(400)
        .json({ error: "Invalid date format. Use YYYY-MM-DD." });
    }

    if (helpers.isBot(req)) {
      res.set("Cache-Control", "public, max-age=300");
      return res
        .status(503)
        .json({ error: "Archive view unavailable to crawlers." });
    }

    const isToday = date === helpers.todayUTC();
    console.log(`[LOG API] Request for ${date}${isToday ? " (today)" : ""}`);

    try {
      let entries;
      if (isToday) {
        entries = hashCache.getAllToday();
      } else {
        const shard = await r2.get(`hashes/${date}.json`);
        entries = shard ? Object.entries(shard) : [];
      }

      if (!entries.length) {
        return res.json({
          date,
          count: 0,
          total: 0,
          hasMore: false,
          hasPrev: false,
          kills: [],
          shipFilter: null,
        });
      }

      const shipFilter = req.query.ship ? parseInt(req.query.ship) : null;
      if (shipFilter) {
        entries = entries.filter(([, value]) => {
          const shipID = typeof value === "object" ? value.shipID : null;
          return shipID === shipFilter;
        });
      }

      const page = Math.max(1, parseInt(req.query.page) || 1);
      const start = (page - 1) * KILLS_PAGE_SIZE;
      const end = start + KILLS_PAGE_SIZE;
      const reversed = [...entries].reverse();
      const pageEntries = reversed.slice(start, end);

      const limit = pLimit(KILLS_CONCURRENCY);
      const kills = await Promise.all(
        pageEntries.map((entry) => limit(() => summariseKill(entry))),
      );
      const validKills = kills.filter(Boolean);

      setCacheHeader(res, { isToday, todayMaxAge: 30 });
      res.json({
        date,
        page,
        pageSize: KILLS_PAGE_SIZE,
        count: validKills.length,
        total: entries.length,
        hasMore: reversed.length > end,
        hasPrev: page > 1,
        shipFilter,
        kills: validKills,
      });
    } catch (err) {
      console.error(`[LOG API] Error for ${date}: ${err.message}`);
      res.status(500).json({ error: "Internal error" });
    }
  }

  // -------------------------------------------------------------------------
  // Route mounts (order is the same as the original file)
  // -------------------------------------------------------------------------

  // Kill routes
  app.use(require("../routes/ogRoutes")(esi));
  app.get("/api/kill/:killID", withColdGate(handleKillDetail, isHotKill));
  app.get("/api/kill/:date/:killID", withColdGate(handleKillDetail, isHotKill));
  app.get("/api/kills/:date", withColdGate(handleKillsByDate, isTodayLog));

  // Ticker page may be framed by the main site
  app.use("/ticker.html", (req, res, next) => {
    res.removeHeader("X-Frame-Options");
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'self' https://socketkill.com",
    );
    next();
  });

  // Other route modules
  app.use(require("../routes/sitemapRoutes")());
  app.use(require("../routes/entityRoutes")(esi));
  app.use(require("../routes/statsRoutes")(esi));
  app.use(require("../routes/adminRoutes")(getProcessor));

  // Static files and root redirect
  app.use(express.static(PUBLIC_DIR));
  app.get("/", (req, res) => res.redirect(301, "https://socketkill.com"));

  // -------------------------------------------------------------------------
  // Socket rooms
  // -------------------------------------------------------------------------
  io.on("connection", (socket) => {
    console.log(`Client connected to Web Socket Stream: ${socket.id}`);

    joinNumericRoom(socket, "character", "char", "TICKER");
    joinNumericRoom(socket, "kick", "kick", "KICK");

    const ytParam = socket.handshake.query.yt;
    if (typeof ytParam === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(ytParam)) {
      socket.join(`yt:${ytParam}`);
      console.log(`[YT] ${socket.id} joined yt:${ytParam}`);
    }

    socket.on("disconnect", (reason) => {
      console.log(
        `[NETWORK] Client disconnected: ${socket.id} | Reason: ${reason} | Active: ${io.engine.clientsCount}`,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Background refreshes
  // -------------------------------------------------------------------------
  startRefresh("PLEX", plexRate, 12 * HOUR_MS);
  startRefresh("NPC", npcKills, HOUR_MS);

  // -------------------------------------------------------------------------
  // Listen
  // -------------------------------------------------------------------------
  server
    .listen(PORT, () => {
      console.log(`Web Module Loaded on ${PORT}`);
    })
    .on("error", (err) => {
      console.error(
        `[SERVER] Listen failed on port ${PORT}: ${err.code} — ${err.message}`,
      );
      process.exit(1);
    });

  return { app, io };
}

module.exports = startWebServer;
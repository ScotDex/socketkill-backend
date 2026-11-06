const express = require("express");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { clientIp, IMMUTABLE } = require("../core/requestMeta");
const hashCache = require("../state/hashCache");
const killmailCache = require("../state/killmailCache");
const killmailResolver = require("../core/killmailResolver");
const r2 = require("../network/r2Writer");
const { renderOgCard } = require("../services/ogCard");
const {
  renderPageCard,
  renderEntityCard,
  PAGES,
} = require("../services/pageCards");

const { ENTITY_COLUMNS } = require("../core/entityMaps");

const ogLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  message: { error: "Too many card renders — slow down." },
});

module.exports = function ogRoutes(esi) {
  const router = express.Router();

  const ENTITY_NAME = {
  pilot: (id) => esi.getCharacterName(id),
  corp: (id) => esi.getCorporationName(id),
  alliance: (id) => esi.getAllianceName(id),
};

async function resolveEntityName(type, id) {
  const fn = ENTITY_NAME[type];
  if (!fn) return null;
  try {
    const name = await fn(id);
    return typeof name === "string" && name.trim() ? name : null;
  } catch {
    return null;
  }
}

  router.get("/og/entity/:type/:id", ogLimiter, async (req, res) => {
    const { type } = req.params;
    const id = parseInt(req.params.id);

    if (!ENTITY_COLUMNS[type] || !Number.isFinite(id) || id <= 0) {
      res.set("Cache-Control", "no-store");
      return res.status(400).json({ error: "Invalid entity type or id" });
    }

    try {
      const name = await resolveEntityName(type, id);
      if (!name) {
        res.set("Cache-Control", "public, max-age=300");
        return res.status(404).json({ error: "Entity not found" });
      }

      const png = await renderEntityCard({
        type,
        id,
        name,
        description: PAGES.home.description,
      });

      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=3600");
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      res.send(png);
    } catch (err) {
      console.error(`[OG ENTITY] ${type}/${id} failed: ${err.message}`);
      res.set("Cache-Control", "no-store");
      res.status(500).json({ error: "Card render failed" });
    }
  });

  router.get("/og/:killID", ogLimiter, async (req, res) => {
    const id = parseInt(req.params.killID);
    if (!Number.isFinite(id) || id <= 0) {
      res.set("Cache-Control", "no-store");
      return res.status(400).json({ error: "Invalid killID" });
    }

    try {
      let date = null;
      const now = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(now.getTime() - i * 86400000)
          .toISOString()
          .slice(0, 10);
        if (await hashCache.getHashFromShard(d, id)) {
          date = d;
          break;
        }
      }
      if (!date) {
        const km = await r2.get(`killmails/${id}.json`).catch(() => null);
        if (km?.killmail_time) date = km.killmail_time.slice(0, 10);
      }
      if (!date) {
        res.set("Cache-Control", "no-store");
        return res.status(404).json({ error: "Kill not found" });
      }

      const isToday = date === new Date().toISOString().slice(0, 10);
      let payload = null;
      if (!isToday) {
        payload = await r2
          .get(`kill-responses/${date}/${id}.json`)
          .catch(() => null);
      }
      if (!payload) {
        const hash = await hashCache.getHashFromShard(date, id);
        if (!hash) {
          res.set("Cache-Control", "no-store");
          return res.status(404).json({ error: "Kill not found" });
        }
        const killmail = await killmailCache.get(id, hash);
        const s = await killmailResolver.resolveKillSummary(killmail, id, esi);
        payload = {
          victim: s.victim,
          totalValue: s.formattedValue,
          rawValue: s.rawValue,
          system: s.system,
        };
      }
      if (!payload?.victim?.shipTypeID || !payload?.victim?.name) {
        res.set("Cache-Control", "public, max-age=300");
        return res
          .status(503)
          .json({ error: "Kill still resolving. Retry shortly." });
      }

      const png = await renderOgCard(payload);
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", IMMUTABLE);
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      res.send(png);
    } catch (err) {
      console.error(`[OG CARD] ${id} failed: ${err.message}`);
      res.set("Cache-Control", "no-store");
      res.status(500).json({ error: "Card render failed" });
    }
  });

  router.get("/og/page/:key", ogLimiter, async (req, res) => {
    const key = req.params.key;
    if (!PAGES[key]) {
      res.set("Cache-Control", "no-store");
      return res.status(404).json({ error: "Unknown page" });
    }
    try {
      const png = await renderPageCard(key);
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=3600");
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      res.send(png);
    } catch (err) {
      console.error(`[OG PAGE] ${key} failed: ${err.message}`);
      res.set("Cache-Control", "no-store");
      res.status(500).json({ error: "Card render failed" });
    }
  });

  return router;
};

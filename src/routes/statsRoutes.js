const express = require("express");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { clientIp } = require("../core/requestMeta");
const hashCache = require("../state/hashCache");
const kvClient = require("../network/kvClient");
const plexRate = require("../services/plexRate");
const npcKills = require("../services/npcKills");

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = clientIp(req);
    return ipKeyGenerator(ip);
  },
  message: { error: "Too many searches — slow down." },
});

module.exports = function statsRoutes(esi) {
  const router = express.Router();
  let lastSdeStamp = null;

    router.get("/api/search", searchLimiter, (req, res) => {
    const { parseIDList, parseSpaceList } = require("../core/apiHelpers");
    const WINDOWS = { "1h": 3.6e6, "6h": 2.16e7, "24h": 8.64e7 };
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
      solo: req.query.solo === "true",
    };

    const results = hashCache.search(filters);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const PAGE_SIZE = 50;
    const start = (page - 1) * PAGE_SIZE;
    const slice = results.slice(start, start + PAGE_SIZE);

    console.log(`[SEARCH] ip=${clientIp(req)} matches=${results.length} page=${page}`);

    res.set("Cache-Control", "public, max-age=30");
    res.json({
      total: results.length,
      page,
      pageSize: PAGE_SIZE,
      hasMore: results.length > start + PAGE_SIZE,
      hasPrev: page > 1,
      kills: slice,
    });
  });

  router.get("/api/plex-rate", (req, res) => {
    const rate = plexRate.get();
    if (!rate) return res.status(503).json({ error: "PLEX rate unavailable" });
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ gbpPerIsk: rate.gbpPerIsk });
  });

  router.get("/api/top10", async (req, res) => {
    try {
      const cutoff = Date.now() - 60 * 60 * 1000;
      const entries = hashCache.search({}).filter((e) => {
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
      const idCount = (pairs) =>
        pairs.map(([id, count]) => ({ id: Number(id), count }));
      const resolveNames = (pairs, fn) =>
        Promise.all(pairs.map(([id]) => fn(Number(id)).catch(() => null))).then(
          (names) =>
            pairs.map(([id, count], i) => ({
              id: Number(id),
              name: names[i],
              count,
            })),
        );

      const corpNames = new Map();
      for (const e of entries)
        if (e.victimCorpID && e.corpName)
          corpNames.set(e.victimCorpID, e.corpName);
      const victimCorp = tally(entries, (e) => e.victimCorpID).map(
        ([id, count]) => ({
          id: Number(id),
          name: corpNames.get(Number(id)) ?? null,
          count,
        }),
      );
      const victimAlliance = await resolveNames(
        tally(entries, (e) => e.victimAllianceID),
        (id) => esi.getAllianceName(id),
      );
      const killers = entries.filter((e) => !e.finalBlowIsNpc);
      const killerCorp = await resolveNames(
        tally(killers, (e) => e.finalBlowCorpID),
        (id) => esi.getCorporationName(id),
      );
      const killerAlliance = await resolveNames(
        tally(killers, (e) => e.finalBlowAllianceID),
        (id) => esi.getAllianceName(id),
      );

      const topValue = [...entries]
        .sort((a, b) => (b.totalValue || 0) - (a.totalValue || 0))
        .slice(0, 10)
        .map((e) => ({
          killID: e.killID,
          value: e.totalValue || 0,
          shipID: e.shipID ?? null,
          victimName: e.victimName ?? null,
          systemID: e.systemID ?? null,
        }));

      res.set("Cache-Control", "public, max-age=60");
      res.json({
        window: "1h",
        generatedAt: new Date().toISOString(),
        sampleSize: entries.length,
        ships: idCount(tally(entries, (e) => e.shipID)),
        shipGroups: idCount(tally(entries, (e) => e.shipGroupID)),
        systems: idCount(tally(entries, (e) => e.systemID)),
        regions: idCount(tally(entries, (e) => e.regionID)),
        victimCorp,
        victimAlliance,
        finalBlowWeapon: idCount(tally(killers, (e) => e.finalBlowWeaponID)),
        killerShip: idCount(tally(killers, (e) => e.finalBlowShipID)),
        killerCorp,
        killerAlliance,
        topValue,
      });
    } catch (err) {
      console.error("[TOP10] error:", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.get("/api/filter-source", async (req, res) => {
    try {
      const meta = await kvClient.get("sde:meta", { ttlMs: 60_000 });
      const stamp = meta
        ? `${meta.buildNumber}-${meta.schemaVersion ?? 0}`
        : null;
      const stale = Boolean(stamp && stamp !== lastSdeStamp);

      const [systems, regions, groups, ships, items] = await Promise.all([
        kvClient.get("sde:systems", { bypassCache: stale }),
        kvClient.get("sde:regions", { bypassCache: stale }),
        kvClient.get("sde:groups", { bypassCache: stale }),
        kvClient.get("sde:ships", { bypassCache: stale }),
        kvClient.get("sde:items", { bypassCache: stale }),
      ]);

      if (stale) lastSdeStamp = stamp;

      const missing = {
        systems: !systems,
        regions: !regions,
        groups: !groups,
        ships: !ships,
        items: !items,
      };
      if (Object.values(missing).some(Boolean)) {
        return res
          .status(503)
          .json({ error: "Filter source incomplete", missing });
      }

      const etag = meta?.buildNumber
        ? `"sde-${meta.buildNumber}-${meta.schemaVersion ?? 0}"`
        : null;

      if (etag && req.headers["if-none-match"] === etag) {
        res.set("ETag", etag);
        return res.status(304).end();
      }

      res.set("Cache-Control", "public, max-age=3600, must-revalidate");
      if (etag) res.set("ETag", etag);

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
      console.error("[filter-source] error:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.get("/stats/npc-kills", (req, res) => {
    const data = npcKills.get();
    if (!data)
      return res.status(503).json({ error: "NPC data initializing..." });
    res.json(data);
  });

  // ← paste: /api/search, /api/plex-rate, /api/top10,
  //   /api/filter-source, /stats/npc-kills  (app.get → router.get)

  return router;
};

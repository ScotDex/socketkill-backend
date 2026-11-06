const express = require("express");
const hashCache = require("../state/hashCache");
const r2 = require("../network/r2Writer");
const { setCacheHeader } = require("../core/requestMeta");
const { WHALE_THRESHOLD } = require("../services/whaleModule");

const SITE = "https://socketkill.com";

module.exports = function sitemapRoutes() {
  const router = express.Router();

  router.get("/sitemaps/kills-index.xml", (req, res) => {
    const days = [];
    const start = new Date(Date.now() - 7 * 86400000);
    for (let d = new Date(); d >= start; d.setDate(d.getDate() - 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${days
      .map(
        (d) =>
          `  <sitemap><loc>${SITE}/sitemaps/kills/${d}.xml</loc><lastmod>${d}</lastmod></sitemap>`,
      )
      .join("\n")}\n</sitemapindex>`;
    res.set("Content-Type", "application/xml");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(xml);
  });

  router.get("/sitemaps/kills/:date.xml", async (req, res) => {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).send("Invalid date");
    const today = new Date().toISOString().slice(0, 10);
    const isToday = date === today;

    let entries;
    if (isToday) {
      entries = hashCache.getAllToday();
    } else {
      const shard = await r2.get(`hashes/${date}.json`);
      entries = shard ? Object.entries(shard) : [];
    }

    const ids = entries
      .filter(
        ([, e]) =>
          typeof e === "object" &&
          e !== null &&
          (e.totalValue || 0) >= WHALE_THRESHOLD,
      )
      .map(([killID]) => killID);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${ids
      .map(
        (id) =>
          `  <url><loc>${SITE}/kill/${id}</loc><lastmod>${date}</lastmod></url>`,
      )
      .join("\n")}\n</urlset>`;
    res.set("Content-Type", "application/xml");
    setCacheHeader(res, { isToday, todayMaxAge: 3600 });
    res.send(xml);
  });

  return router;
};

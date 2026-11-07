const express = require('express');
const axios = require('../network/agent');
const d1 = require('../network/d1Client');
const { ENTITY_COLUMNS } = require('../routes/entityMaps');


const ENTITY_IDENTITY = {
  pilot:    id => `https://esi.evetech.net/characters/${id}`,
  corp:     id => `https://esi.evetech.net/corporations/${id}`,
  alliance: id => `https://esi.evetech.net/alliances/${id}`,
};

async function fetchEsi(url, ms = 4000) {
  try {
    const { data } = await axios.get(url, {
      headers: { 'X-Compatibility-Date': '2026-08-14' },
      timeout: ms,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, status: err.response?.status ?? 0 };
  }
}

module.exports = function entityRoutes(esi) {
  const router = express.Router();

router.get('/api/entity/:type/:id', async (req, res) => {
    const cols = ENTITY_COLUMNS[req.params.type];
    const id = parseInt(req.params.id);
    if (!cols || !Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid entity type or id' });
    }

  const type = req.params.type;

    try {
      const FIELDS = 'kill_id, kill_time, system_id, region_id, space, total_value, ship_type_id, attacker_count';

      const [lossRes, killRes, identityRes, memberCorpsRes] = await Promise.all([
        d1.query(
          `SELECT ${FIELDS} FROM kills WHERE ${cols.victim} = ? ORDER BY kill_time DESC`,
          [id]
        ),
        d1.query(
          `SELECT DISTINCT k.kill_id, k.kill_time, k.system_id, k.region_id, k.space, k.total_value, k.ship_type_id, k.attacker_count
           FROM kills k JOIN kill_attackers ka ON ka.kill_id = k.kill_id
           WHERE ka.${cols.attacker} = ? ORDER BY k.kill_time DESC`,
          [id]
        ),
        fetchEsi(ENTITY_IDENTITY[type](id)),
        type === 'alliance'
          ? fetchEsi(`https://esi.evetech.net/alliances/${id}/corporations/`)
          : null,
      ]);

      const rows = new Map();
      for (const r of killRes.result?.[0]?.results ?? []) rows.set(r.kill_id, { ...r, isLoss: false });
      for (const r of lossRes.result?.[0]?.results ?? []) rows.set(r.kill_id, { ...r, isLoss: true }); 

      const merged = [...rows.values()]
        .sort((a, b) => b.kill_time.localeCompare(a.kill_time))

      const events = await Promise.all(merged.map(async r => {
        const sys = esi.getSystemDetails(r.system_id);
        return {
          killID: r.kill_id,
          isLoss: r.isLoss,
          shipTypeID: r.ship_type_id,
          shipName: await esi.getTypeName(r.ship_type_id),
          systemName: sys?.name ?? 'Unknown System',
          regionName: r.region_id ? await esi.getRegionName(r.region_id) : 'K-Space',
          space: r.space,
          totalValue: r.total_value,
          time: r.kill_time,
          attackerCount: r.attacker_count,
        };
      }));

      let identity = null;
      if (identityRes.ok) {
        const raw = identityRes.data;
        const corpID     = type === 'pilot'    ? (raw.corporation_id ?? null) : null;
        const allianceID = type !== 'alliance' ? (raw.alliance_id ?? null) : null;
        const ceoID      = type === 'corp'     ? (raw.ceo_id ?? null) : null;
        const executorID = type === 'alliance' ? (raw.executor_corporation_id ?? null) : null;

        const [corp, alliance, ceo, executor] = await Promise.all([
          corpID     ? esi.getCorporationName(corpID)     : null,
          allianceID ? esi.getAllianceName(allianceID)    : null,
          ceoID      ? esi.getCharacterName(ceoID)        : null,
          executorID ? esi.getCorporationName(executorID) : null,
        ]);

        const clean = n => (n && n !== 'Unknown' ? n : null);

        identity = {
          raw,
          names: {
            corp:     clean(corp),
            alliance: clean(alliance),
            ceo:      clean(ceo),
            executor: clean(executor),
          },
          corpCount: memberCorpsRes?.ok ? memberCorpsRes.data.length : null,
        };
      }

      res.set('Cache-Control', 'public, max-age=60');
      res.json({
        windowDays: 30,
        events,
        identity,
        identityStatus: identityRes.ok ? 200 : identityRes.status,
      });
    } catch (err) {
      console.error(`[ENTITY API] ${req.params.type}/${id} failed: ${err.message}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
};
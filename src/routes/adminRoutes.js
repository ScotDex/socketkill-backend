const express = require('express');
const axios = require('../network/agent');

module.exports = function adminRoutes(getProcessor) {
  const router = express.Router();

  router.get('/api/refire/:killId', async (req, res) => {
    const processor = getProcessor();
    if (!processor) {
      console.warn('[REFIRE] Processor not ready');
      return res.status(503).json({ error: 'Processor not ready' });
    }
    try {
      const killId = req.params.killId;
      console.log(`[REFIRE] Requested kill ${killId}`);

      const zkillRes = await axios.get(
        `https://zkillboard.com/api/killID/${killId}/`
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
        `https://esi.evetech.net/killmails/${killId}/${hash}/`,
        { headers: { 'X-Compatibility-Date': '2026-08-14' } }
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

  return router;
};
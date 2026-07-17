const axios = require('../network/agent');

let npcData = null;

async function refresh() {
    const res = await axios.get(
        'https://esi.evetech.net/latest/universe/system_kills/',
        { headers: { 'X-Compatibility-Date': '2025-12-16' } }
    );
    const rawData = res.data;
    if (!Array.isArray(rawData)) throw new Error('bad system_kills response');

    npcData = {
        total: rawData.reduce((acc, s) => acc + (s.npc_kills || 0), 0),
        systemsActive: rawData.length,
        lastUpdated: new Date().toISOString(),
    };
    console.log(`[NPC] refreshed: ${npcData.total.toLocaleString()} kills/hr across ${npcData.systemsActive} systems`);
}

function get() {
    return npcData;
}

module.exports = { refresh, get };
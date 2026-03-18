const r2 = require('../network/r2Writer');
const talker = require('../network/agent');
const ESI_BASE = 'https://esi.evetech.net/latest';
const normalizer = require('../core/normalizer')

let activeWars = [];

async function loadWars() {
    try {
        const wars = await r2.get('wars.json');
        if (wars) activeWars = wars;
        console.log(`[WARS] Loaded ${activeWars.length} active wars`);
    } catch (err) {
        console.error(`[WARS] Load failed: ${err.message}`);
    }
}

async function pollWarKillmails(processPackage, processedKills) {
    if (!activeWars.length) return;

    for (const war of activeWars){
        try {
            const res = await talker.get (`${ESI_BASE}/wars/${war.id}/killmails/`);
            const killmails = res.data;

            for (const km of killmails) {
                const esiRes = await talker.get(
                    `${ESI_BASE}/killmails/${km.killmail_id}/${km.killmail_hash}/`
                );
                
                const killPackage = normalizer.fromESI(km.killmail_id, km.killmail_hash, esiRes.data); // FIX
                if (!killPackage) continue;

                processPackage(killPackage);
                console.log(`[WARS] Kill ${km.killmail_id} processed from war ${war.id}`);
            }
        } catch (err) {
            console.error(`[WARS] Poll failed for war ${war.id}: ${err.message}`);
        }
    }
}

async function syncWars() {
    try {
        const res = await talker.get (`${ESI_BASE}/wars/`);
        const warIds = res.data;

        const wars = await Promise.all (
            warIds.slice(0,100).map(async id => {
                try {
                const war = await talker.get (`${ESI_BASE}/wars/${id}/`);
                return war.data;
            } catch {
                return null;
            }
        })
    );

    const active = wars.filter(w => w && !w.finished);
    await r2.put('wars.json', active);
    activeWars = active;
    console.log(`[WARS] Synced ${active.length} active wars to R2`);
} catch (err) {
    console.error(`[WARS] Sync failed: ${err.message}`);
}
}

module.exports = { syncWars, loadWars, pollWarKillmails };
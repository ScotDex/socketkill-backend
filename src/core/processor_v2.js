const helpers = require("./helpers");
const handleWhale = require("../services/whaleModule");
const { resolveKillmail, resolveFinalBlowCorp, resolveTriggerAttacker } = require('./processorHelpers');
const { TRIGLAVIAN_SYSTEMS } = require('../core/shipIDs');
const hashCache = require('../state/hashCache')

module.exports = (esi, io, statsManager) => {
    async function processPackage(packageData) {
        const startProcessing = process.hrtime.bigint();
        const { zkb, killID, isR2, esiData, hash } = packageData;

        if (hash) hashCache.set(killID, hash);

        try {
            const killmail = await resolveKillmail(isR2, esiData, zkb);
            const rawValue = Number(zkb.totalValue) || 0
            //

            const [systemDetails, shipName, charName, corpName, finalBlowCorp, allianceName] = await Promise.all([
                esi.getSystemDetails(killmail.solar_system_id),
                esi.getTypeName(killmail.victim.ship_type_id),
                esi.getCharacterName(killmail.victim?.character_id),
                esi.getCorporationName(killmail.victim?.corporation_id),
                resolveFinalBlowCorp(killmail, esi),
                killmail.victim?.alliance_id
                    ? esi.getAllianceName(killmail.victim.alliance_id)
                    : Promise.resolve(null),

            ]);
            const attackerCount = killmail.attackers?.length || 0;
            const finalVictimName = (charName == "Unknown" || !charName) ? corpName : charName;
            statsManager.increment(rawValue);

            const systemName = systemDetails?.name || "Unknown System";
            const regionName = systemDetails?.region_id
                ? await esi.getRegionName(systemDetails.region_id)
                : "K-Space";

            const { triggerShipName, triggerCharName, triggerCorpName, triggerShipId } = await resolveTriggerAttacker(killmail, esi);

            const durationMs = Number(process.hrtime.bigint() - startProcessing) / 1_000_000;
            console.log(`[PERF] Kill ${killID} | Latency: ${durationMs.toFixed(3)}ms`);
            io.emit("gatekeeper-stats", {
                totalScanned: statsManager.getTotal(),
                totalisk: statsManager.totalIsk
            });
            io.emit("raw-kill", {
                id: killID,
                val: rawValue,
                ship: shipName,
                system: systemName,
                region: regionName,
                corpName: corpName,
                systemId: killmail.solar_system_id,
                article: helpers.getArticle(shipName),
                shipId: killmail.victim.ship_type_id,
                href: zkb.href,
                locationLabel: `System: ${systemName} | Region: ${regionName} | Final Blow: ${finalBlowCorp}`,
                zkillUrl: helpers.getSocketKillLink(killID),
                victimName: finalVictimName,
                shipImageUrl: `https://api.socketkill.com/render/ship/${killmail.victim.ship_type_id}`,
                corpImageUrl: `https://api.socketkill.com/render/corp/${killmail.victim.corporation_id}`,
                allianceImageUrl: `https://api.socketkill.com/render/alliance/${killmail.victim.alliance_id}`,
                finalBlowCorp: finalBlowCorp,
                attackerCount: attackerCount,
                isTriglavian: TRIGLAVIAN_SYSTEMS.has(killmail.solar_system_id),
                allianceName: allianceName,
            });

            // Gated filter for web hooks

            handleWhale(killmail, zkb, {
                shipName,
                systemName,
                charName,
                corpName,
                rawValue,
                regionName,
                allianceName,
                finalBlowCorp,
                attackerCount,
                triggerShipName,
                triggerCharName,
                triggerCorpName,
                triggerShipId,
                finalVictimName
            });

        } catch (err) {
            console.error(`[PROCESSOR-ERR] Kill ${killID} failed: ${err.message}`);
        }
    }

    return { processPackage };
}




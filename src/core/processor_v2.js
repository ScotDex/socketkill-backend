const helpers = require("./helpers");
const handleWhale = require("../services/whaleModule");
const { resolveKillmail, resolveFinalBlowCorp, resolveTriggerAttacker, resolveSpace, topByDamage } = require('./processorHelpers');
const { TRIGLAVIAN_SYSTEMS } = require('../core/shipIDs');
const hashCache = require('../state/hashCache')
const { calculateKillValue } = require('../services/priceService');
const d1 = require('../network/d1Client');
const hashIndex = require('../state/hashIndex');

module.exports = (esi, io, statsManager) => {
    async function processPackage(packageData) {
        const startProcessing = process.hrtime.bigint();
        const { zkb, killID, isR2, esiData, hash } = packageData;

        try {
            const killmail = await resolveKillmail(isR2, esiData, zkb);
            const rawValue = calculateKillValue(killmail);
            const [systemDetails, shipName, charName, corpName, finalBlowCorp, allianceInfo, shipGroupID] = await Promise.all([
                esi.getSystemDetails(killmail.solar_system_id),
                esi.getTypeName(killmail.victim.ship_type_id),
                esi.getCharacterName(killmail.victim?.character_id),
                esi.getCorporationName(killmail.victim?.corporation_id),
                resolveFinalBlowCorp(killmail, esi),
                killmail.victim?.alliance_id
                    ? esi.getAllianceInfo(killmail.victim.alliance_id)
                    : Promise.resolve(null),
                esi.getShipGroupID(killmail.victim.ship_type_id),

            ]);
            const finalVictimName = (charName == "Unknown" || !charName) ? corpName : charName;
            const space = resolveSpace(killmail.solar_system_id, systemDetails?.security_status);
            const finalBlow = killmail.attackers?.find(a => a.final_blow) || null;
            const allianceName = allianceInfo?.name ?? null;
            const allianceTicker = allianceInfo?.ticker ?? null;

            hashCache.set(killID, {
                hash,
                shipID: killmail.victim.ship_type_id,
                shipGroupID,
                systemID: killmail.solar_system_id,
                regionID: systemDetails?.region_id ?? null,
                space: space,
                totalValue: rawValue,
                attackerCount: killmail.attackers?.length || 0,
                victimCorpID: killmail.victim.corporation_id ?? null,
                victimAllianceID: killmail.victim.alliance_id ?? null,
                time: killmail.killmail_time,
                victimName: finalVictimName,
                corpName,
                finalBlowWeaponID: finalBlow?.weapon_type_id ?? null,
                finalBlowShipID: finalBlow?.ship_type_id ?? null,
                finalBlowCorpID: finalBlow?.corporation_id ?? null,
                finalBlowAllianceID: finalBlow?.alliance_id ?? null,
                allianceTicker: allianceTicker,
                finalBlowIsNpc: !finalBlow?.character_id,
            });
            hashIndex.record(killID, hash);
            const weaponTypeIDs = [... new Set(
                (killmail.attackers || [])
                    .filter(a => a.character_id != null && a.weapon_type_id != null)
                    .map(a => a.weapon_type_id)
            )];
            const attackerCount = killmail.attackers?.length || 0;

            const killRow = {
                killID,
                hash,
                time: killmail.killmail_time,
                systemID: killmail.solar_system_id,
                regionID: systemDetails?.region_id ?? null,
                space: space,
                totalValue: rawValue,
                victimCharacterID: killmail.victim?.character_id ?? null,
                victimCorpID: killmail.victim?.corporation_id ?? null,
                victimAllianceID: killmail.victim?.alliance_id ?? null,
                shipID: killmail.victim.ship_type_id,
                attackerCount: killmail.attackers?.length || 0,
            };
            d1.recordKill(killRow, (killmail.attackers || []).filter(a => a.character_id))
                .catch(err => console.error(`[D1] Kill ${killID} persist failed: ${err.message}`));

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
                totalIsk: statsManager.totalIsk
            });
            const rawKillPayload = {
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
                shipImageUrl: `https://images.evetech.net/types/${killmail.victim.ship_type_id}/render`, // testing
                corpImageUrl: `https://images.evetech.net/corporations/${killmail.victim.corporation_id}/logo`,
                allianceImageUrl: killmail.victim.alliance_id
                    ? `https://images.evetech.net/alliances/${killmail.victim.alliance_id}/logo`
                    : `https://images.evetech.net/alliances/1/logo`,
                finalBlowCorp: finalBlowCorp,
                attackerCount: attackerCount,
                isTriglavian: TRIGLAVIAN_SYSTEMS.has(killmail.solar_system_id),
                allianceName: allianceName,
                space: space,
                weaponTypeIDs,
                corporationId: killmail.victim.corporation_id ?? null,
                allianceId: killmail.victim.alliance_id ?? null,
                characterId: killmail.victim?.character_id ?? null,
                allianceTicker: allianceTicker,
            };

            io.emit("raw-kill", rawKillPayload);

            const involvedCharIds = new Set();
            if (killmail.victim?.character_id) involvedCharIds.add(killmail.victim.character_id);
            for (const a of killmail.attackers || []) {
                if (a.character_id) involvedCharIds.add(a.character_id);
            }
            for (const charId of involvedCharIds) {
                io.to(`char:${charId}`).emit("char-kill", {
                    ...rawKillPayload,
                    isLoss: killmail.victim?.character_id === charId,
                });
            }

            // Gated filter for web hooks action posts.

            handleWhale(killmail,  {
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
                finalVictimName,
                allianceTicker,
                securityStatus: systemDetails?.security_status ?? null,
                space,
            });

        } catch (err) {
            console.error(`[PROCESSOR-ERR] Kill ${killID} failed: ${err.message}`);
        }
    }

    return { processPackage };
}




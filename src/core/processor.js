const axios = require("../network/agent"); 
const helpers = require("./helpers");
const { TwitterService, BlueSkyService } = require("../network/twitterService");
const CorpIntelFactory = require("../services/corpIntelFactory");
module.exports = (esi, io, statsManager) => {
    
    
    const WHALE_THRESHOLD = 20000000000;


    async function processPackage(packageData) {
        const startProcessing = process.hrtime.bigint();
        const { zkb, killID, isR2, esiData } = packageData;

        try {
            let killmail;
            if (isR2 && esiData){
                killmail = esiData;
            } else {
                const esiResponse = await axios.get(zkb.href);
                killmail = esiResponse.data;
            }
            const rawValue = Number(zkb.totalValue) || 0;
            const [systemDetails, shipName, charName, corpName, finalBlowCorp] = await Promise.all([
                esi.getSystemDetails(killmail.solar_system_id),
                esi.getTypeName(killmail.victim.ship_type_id),
                esi.getCharacterName(killmail.victim?.character_id),
                esi.getCorporationName(killmail.victim?.corporation_id),
                killmail.attackers?.find(a => a.final_blow)?.corporation_id
                 ? esi.getCorporationName(killmail.attackers.find(a => a.final_blow)?.corporation_id)
                 : Promise.resolve("Unknown")
            ]);
            const attackerCount = killmail.attackers?.length || 0;
            const finalVictimName = (charName == "Unknown" || !charName ) ? corpName : charName;
            statsManager.increment(rawValue);

            const systemName = systemDetails?.name || "Unknown System";
            const regionName = systemDetails?.region_id 
                ? await esi.getRegionName(systemDetails.region_id) 
                : "K-Space";

            const durationMs = Number(process.hrtime.bigint() - startProcessing) / 1_000_000;
            console.log(`[PERF] Kill ${killID} | Latency: ${durationMs.toFixed(3)}ms`);
            io.emit("gatekeeper-stats", { totalScanned: statsManager.getTotal(),
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
                zkillUrl: `https://zkillboard.com/kill/${killID}/`,
                victimName: finalVictimName,
                shipImageUrl: `https://api.socketkill.com/render/ship/${killmail.victim.ship_type_id}`,
                corpImageUrl: `https://api.socketkill.com/render/corp/${killmail.victim.corporation_id}`,
                finalBlowCorp: finalBlowCorp,
                attackerCount: attackerCount
            });

            const isWhale = rawValue >= WHALE_THRESHOLD;
                               

            if (isWhale) {
                await handlePrivateIntel(killmail, zkb, {
                    shipName,
                    systemName,
                    charName,
                    corpName,
                    rawValue
                });
            }

            await handleCorpIntel(killmail, zkb, {
                    shipName,
                    systemName,
                    charName,
                    corpName,
                    rawValue,
                    regionName
            })

        } catch (err) {
            console.error(`[PROCESSOR-ERR] Kill ${killID} failed: ${err.message}`);
        }
    }

    async function handleCorpIntel(kill, zkb, names) {
        if (names.rawValue < WHALE_THRESHOLD) return;
        const payload = CorpIntelFactory.createKillEmbed(kill, zkb, names);
        try {
            await axios.post(process.env.BLANKSPACE_HOOK, payload)
            console.log (`[CORP INTEL] Kill ${kill.killmail_id} posted`);
        } catch (err) {
            console.error(`[CORP INTEL] Webhook failed: ${err.message}`);
        }
        
    }

    async function handlePrivateIntel(kill, zkb, identity) {
        const formattedValue = helpers.formatIsk(identity.rawValue);
        
        try {

            if (identity.rawValue >= WHALE_THRESHOLD) {
                TwitterService.postWhale(identity, formattedValue, kill.killmail_id);
                BlueSkyService.postWhale(identity, formattedValue, kill.killmail_id);
            }
        } catch (err) {
            console.error("Error in handlePrivateIntel:", err.message);
        }
    }

    return { processPackage };
};
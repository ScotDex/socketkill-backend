const axios = require("../network/agent"); 
const helpers = require("./helpers");
const { TwitterService, BlueSkyService } = require("../network/twitterService");
const CorpIntelFactory = require("../services/corpIntelFactory");
module.exports = (esi, io, statsManager) => {
    
    const THERA_ID = 31000005;
    const WHALE_THRESHOLD = 20000000000;
    const isWormholeSystem = (systemId) => systemId >= 31000001 && systemId <= 32000000;

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
            const [systemDetails, shipName, charName, corpName] = await Promise.all([
                esi.getSystemDetails(killmail.solar_system_id),
                esi.getTypeName(killmail.victim.ship_type_id),
                esi.getCharacterName(killmail.victim?.character_id),
                esi.getCorporationName(killmail.victim?.corporation_id)
            ]);

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
                systemId: killmail.solar_system_id,
                article: helpers.getArticle(shipName),
                shipId: killmail.victim.ship_type_id,
                href: zkb.href,
                locationLabel: `System: ${systemName} | Region: ${regionName} | Corporation: ${corpName}`,
                zkillUrl: `https://zkillboard.com/kill/${killID}/`,
                victimName: finalVictimName,
                shipImageUrl: `https://api.socketkill.com/render/ship/${killmail.victim.ship_type_id}`,
                corpImageUrl: `https://api.socketkill.com/render/corp/${killmail.victim.corporation_id}`
            });

            const isWhale = rawValue >= WHALE_THRESHOLD;
            const isRelevantWH = isWormholeSystem(killmail.solar_system_id) && 
                               killmail.solar_system_id !== THERA_ID && 
                               mapper.isSystemRelevant(killmail.solar_system_id);

            if (isWhale || isRelevantWH) {
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
            if (mapper.isSystemRelevant(kill.solar_system_id)) {
                const metadata = mapper.getSystemMetadata(kill.solar_system_id);
                
                const names = {
                    ...identity,
                    scoutName: metadata ? metadata.scannedBy : "Unknown Scout",
                    isAdjacent: metadata ? metadata.isAdjacent : false
                };
                
                const tripwireUrl = `${process.env.TRIPWIRE_URL}?system=${encodeURIComponent(identity.systemName)}`;
                const payload = EmbedFactory.createKillEmbed(kill, zkb, names, tripwireUrl);

                if (process.env.INTEL_WEBHOOK_URL) {
                    axios.post(process.env.INTEL_WEBHOOK_URL, payload)
                        .catch(e => console.error("Webhook Failed", e.message));
                }
            }

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
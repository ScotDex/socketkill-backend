const axios = require("../network/agent");
const { AT_SHIP_IDS, OFFICER_SHIP_IDS, RORQUAL_SHIP_IDS, TRIGLAVIAN_SYSTEMS} = require('../core/shipIDs');

async function resolveKillmail(isR2, esiData, zkb) {
    if (isR2 && esiData) return esiData
    const response = await axios.get(zkb.href)
    return response.data;
}

function resolveSpace(systemId, securityStatus) {
    if (systemId >= 31000000 && systemId < 32000000) return 'wh'
    if (TRIGLAVIAN_SYSTEMS.has(systemId)) return 'pochven'
    if (securityStatus == null) return 'unknown'
    if (securityStatus >= 0.5) return 'high'
    if (securityStatus >= 0.1) return 'low'
    return 'null'
}


async function resolveFinalBlowCorp(killmail, esi) {
    const attacker = killmail.attackers?.find(a => a.final_blow);
    if (!attacker) return "Unknown";
    if (attacker.corporation_id) return esi.getCorporationName(attacker.corporation_id);
    if (attacker.ship_type_id) return esi.getTypeName(attacker.ship_type_id);
    return "Unknown";
}

async function resolveTriggerAttacker(killmail, esi) {
    const attacker = killmail.attackers?.find(a =>
        AT_SHIP_IDS.has(a.ship_type_id) || OFFICER_SHIP_IDS.has(a.ship_type_id) || RORQUAL_SHIP_IDS.has(a.ship_type_id)
    )
    if (!attacker) return { triggerShipName: null, triggerCharName: null, triggerCorpName: null, triggerShipId: null };
    const [triggerShipName, triggerCharName, triggerCorpName] = await Promise.all([
        esi.getTypeName(attacker.ship_type_id),
        attacker.character_id ? esi.getCharacterName(attacker.character_id) : Promise.resolve("Unknown"),
        attacker.corporation_id ? esi.getCorporationName(attacker.corporation_id) : Promise.resolve("Unknown")
    ]);

    return { triggerShipName, triggerCharName, triggerCorpName, triggerShipId: attacker.ship_type_id };
}

module.exports = { resolveKillmail, resolveFinalBlowCorp, resolveTriggerAttacker, resolveSpace };

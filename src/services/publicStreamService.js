const publicBroadcaster = require('../network/publicBroadcaster');
const helpers = require('../core/helpers');
const { TRIGLAVIAN_SYSTEMS } = require('../core/shipIDs');

const SCHEMA_VERSION = 1;

function buildPayload(input) {
    const {
        killmail,
        zkb,
        killID,
        shipName,
        systemName,
        regionName,
        corpName,
        victimName,
        finalBlowCorp,
        allianceName,
        attackerCount,
    } = input;


    return {
        schema: SCHEMA_VERSION,
        broadcastedAt: new Date().toISOString(),
        data: {
            killmailId: killID,
            killmailTime: killmail.killmail_time,
            totalValue: Number(zkb.totalValue) || 0,

            victim: {
                characterId: killmail.victim.character_id || null,
                characterName: victimName,
                corporationId: killmail.victim.corporation_id || null,
                corporationName: corpName,
                allianceId: killmail.victim.alliance_id || null,
                allianceName: allianceName,
                shipTypeId: killmail.victim.ship_type_id,
                shipName: shipName,
            },

            finalBlow: {
                corporationName: finalBlowCorp,
            },

            location: {
                systemId: killmail.solar_system_id,
                systemName: systemName,
                regionName: regionName,
                isTriglavian: TRIGLAVIAN_SYSTEMS.has(killmail.solar_system_id),
            },

            attackerCount: attackerCount,

            links: {
                socketkill: helpers.getSocketKillLink(killID),
                zkillboard: helpers.getZkillLink(killID),
                evekill: helpers.getEveKillLink(killID),
                esi: zkb.href,
            },

            images: {
                ship: `https://api.socketkill.com/render/ship/${killmail.victim.ship_type_id}`,
                corporation: `https://api.socketkill.com/render/corp/${killmail.victim.corporation_id}`,
                alliance: `https://api.socketkill.com/render/alliance/${killmail.victim.alliance_id}`,
            },
        },
    };
}

function broadcast(input) {
    const payload = buildPayload(input);
    publicBroadcaster.publish(payload).catch(() => { });
}

module.exports = { broadcast, buildPayload };
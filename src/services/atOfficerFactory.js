const { AT_SHIP_IDS, OFFICER_SHIP_IDS, RORQUAL_SHIP_IDS } = require('../core/shipIDs');
const helpers = require('../core/helpers');

class atOfficerFactory {
    static createKillEmbed(kill, names) {
        const DOTLAN_BASE = 'https://evemaps.dotlan.net'
        const ENTITY_BASE = 'https://socketkill.com'
        const corpIcon = `https://edge.socketkill.com/taylr/logo.png`;
        const triggerAttacker = kill.attackers?.find(a =>
            AT_SHIP_IDS.has(a.ship_type_id) || OFFICER_SHIP_IDS.has(a.ship_type_id) || RORQUAL_SHIP_IDS.has(a.ship_type_id)
        );

      
        return {
            username: "Target Ship Tracker",
            avatar_url: corpIcon,
            embeds: [{
                author: {
                    name: `${names.triggerShipName || 'Unknown'} spotted in ${names.systemName}`,
                    icon_url: `https://images.evetech.net/corporations/${triggerAttacker?.corporation_id}/logo?size=64`,
                    url: helpers.getSocketKillLink(kill.killmail_id),
                },
                thumbnail: { url: `https://images.evetech.net/types/${names.triggerShipId}/render?size=256` },
                color: 0xf39c12,
                fields: [
                    { name: "System", value: `**[${names.systemName}](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Region", value: `**[${names.regionName}](${DOTLAN_BASE}/region/${names.regionName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Pilot", value: names.triggerCharName ? `**[${names.triggerCharName}](${ENTITY_BASE}/pilot/${triggerAttacker?.character_id})**` : 'Unknown', inline: false },
                    { name: "Corporation", value: names.triggerCorpName ? `**[${names.triggerCorpName}](${ENTITY_BASE}/corp/${triggerAttacker?.corporation_id})**` : 'Unknown', inline: false },
                    { name: "Alliance", value: names.allianceName ? `**[${names.allianceName}](${ENTITY_BASE}/alliance/${triggerAttacker?.alliance_id})**` : "No Alliance", inline: false },
                    { name: "Total Value", value: `**${helpers.formatIsk(names.rawValue)} ISK**`, inline: false },
                ],
                footer: {
                    text: `Powered by socketkill.com`,
                    icon_url: "https://edge.socketkill.com/favicon.png"
                },
                timestamp: new Date().toISOString()
            }]
        };
    }
}

module.exports = atOfficerFactory;
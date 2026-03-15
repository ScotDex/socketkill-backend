const { AT_SHIP_IDS, OFFICER_SHIP_IDS } = require('../core/shipIDs');
class atOfficerFactory {
    static createKillEmbed(kill, zkb, names) {
        const DOTLAN_BASE = 'https://evemaps.dotlan.net'
        const corpIcon = `https://edge.socketkill.com/taylr/logo.png`;
        const title = 'Activity Detected';

        const triggerAttacker = kill.attackers?.find(a => 
            AT_SHIP_IDS.has(a.ship_type_id) || OFFICER_SHIP_IDS.has(a.ship_type_id)
        );
        return {
            username: "Officer NPC/AT Ship Tracker",
            avatar_url: corpIcon,
            embeds: [{
                author: {
                    name: `${names.triggerShipName} spotted in ${names.systemName}`,
                    icon_url: `https://images.evetech.net/corporations/${triggerAttacker?.corporation_id}/logo?size=64`
                },
                title: title,
                url: `https://zkillboard.com/kill/${kill.killmail_id}/`,
                thumbnail: { url: `https://images.evetech.net/types/${names.triggerShipId}/render?size=256` },
                color: 0xf39c12,
                fields: [
                    { name: "System", value: `**[${names.systemName}](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Region", value: `**[${names.regionName}](${DOTLAN_BASE}/region/${names.regionName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Pilot", value: names.triggerCharName, inline: false },
                    { name: "Corporation", value: names.triggerCorpName, inline: false },
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
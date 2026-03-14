const helpers = require('../core/helpers')


class atOfficerFactory {
    static createKillEmbed(kill, zkb, names) {
        const DOTLAN_BASE = 'https://evemaps.dotlan.net'
        const totalValue = helpers.formatIsk(zkb.totalValue)
        const corpIcon = `https://edge.socketkill.com/favicon.png`;
        const title = 'Officer Activity Detected';

        return {
            username: "Officer Alarm",
            avatar_url: corpIcon,
            embeds: [{
                author: {
                    name: `${names.charName} lost a ${names.shipName}`,
                    icon_url: `https://images.evetech.net/characters/${kill.victim.character_id}/portrait?size=128`
                },
                title: title,
                url: `https://zkillboard.com/kill/${kill.killmail_id}/`,
                thumbnail: { url: `https://images.evetech.net/types/${kill.victim.ship_type_id}/render?size=256` },
                color: 0xf39c12,
                fields: [
                    { name: "System", value: `** [${names.systemName}](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')}) ** `, inline: false },
                    { name: "Region", value: names.regionName, inline: false },
                    { name: "Corporation", value: names.corpName, inline: false },
                    { name: "Final Blow", value: names.finalBlowCorp, inline: false },
                    { name: "Total Value", value: `**${totalValue} ISK**`, inline: false },
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
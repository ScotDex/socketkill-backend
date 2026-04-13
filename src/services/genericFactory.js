const helpers = require('../core/helpers');

const CATEGORY_CONFIG = {
    at_ships:         { color: 0x3fb950 },
    rorqual_activity: { color: 0xf39c12 },
    all_kills:        { color: 0x4a4a52 },
    officer:          { color: 0xf39c12 },
    value_1b:         { color: 0x5dade2 },
    value_10b:        { color: 0x5dade2 },
    value_20b:        { color: 0x5dade2 },
    titan_loss:       { color: 0x5dade2 },
    super_loss:       { color: 0x5dade2 },
    pochven:          { color: 0x5dade2 },
};

const DOTLAN_BASE = 'https://evemaps.dotlan.net';
const KILLMAIL_BASE = `https://zkillboard.com/`;

class NewsEmbedFactory {
    static createEmbed(kill, zkb, names, category) {
        const config = CATEGORY_CONFIG[category] || { color: 0x3fb950 }
        const totalValue = helpers.formatIsk(zkb.totalValue);

        return {
            username: "Socket.Kill Intel",
            avatar_url: "https://edge.socketkill.com/favicon.png",
            embeds: [{
                author: {
                    name: `${names.finalVictimName} lost a ${names.shipName}`,
                    icon_url: `https://images.evetech.net/characters/${kill.victim.character_id}/portrait?size=64`,
                    url: `${KILLMAIL_BASE}character/${kill.victim.character_id}/`
                },
                color: config.color,
                thumbnail: {
                    url: `https://images.evetech.net/types/${kill.victim.ship_type_id}/render?size=128`
                },
                fields: [
                    { name: "System", value: `**[${names.systemName}](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Region", value: `**[${names.regionName}](${DOTLAN_BASE}/region/${names.regionName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Report", value: `Final blow: ${names.finalBlowCorp} · ${names.attackerCount} attackers`, inline: false },
                    {
                        name: "Corporation",
                        value: kill.victim.corporation_id
                            ? `[${names.corpName}](https://zkillboard.com/corporation/${kill.victim.corporation_id}/)`
                            : "—",
                        inline: false
                    },
                    {
                        name: "Alliance",
                        value: kill.victim.alliance_id
                            ? `[${names.allianceName}](https://zkillboard.com/alliance/${kill.victim.alliance_id}/)`
                            : "—",
                        inline: false
                    },
                    { name: "Value", value: `**${totalValue} ISK**`, inline: false },
                ],
                footer: {
                    text: "Socket.Kill | Real-time EVE Intel",
                    icon_url: "https://edge.socketkill.com/favicon.png"
                },
                timestamp: new Date().toISOString()
            }]
        };
    }
}

module.exports = NewsEmbedFactory;
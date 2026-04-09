const helpers = require('../core/helpers');

const CATEGORY_CONFIG = {
    value_1b:       { label: 'KILL DETECTED',       color: 0x3fb950 },
    value_10b:      { label: 'MAJOR KILL',          color: 0xf39c12 },
    value_100b:     { label: 'CATASTROPHIC KILL',   color: 0xe74c3c },
    capitals:       { label: 'CAPITAL KILL',        color: 0x3498db },
    supercapitals:  { label: 'SUPERCAPITAL KILL',   color: 0x9b59b6 },
    at_ships:       { label: 'AT SHIP SIGHTING',    color: 0xe74c3c },
    officer:        { label: 'OFFICER ACTIVITY',        color: 0xf39c12 },
    rorqual:        { label: 'RORQUAL SPOTTED',     color: 0xf39c12 },
    titan_loss:     { label: 'TITAN DESTROYED',     color: 0xf39c12 },
};

const DOTLAN_BASE = 'https://evemaps.dotlan.net';

class NewsEmbedFactory {
    static createEmbed(kill, zkb, names, category) {
        const config = CATEGORY_CONFIG[category] || { label: 'KILL DETECTED', color: 0x3fb950 };
        const totalValue = helpers.formatIsk(zkb.totalValue);

        return {
            username: "Socket.Kill Intel",
            avatar_url: "https://edge.socketkill.com/favicon.png",
            embeds: [{
                title: config.label,
                url: `https://zkillboard.com/kill/${kill.killmail_id}/`,
                color: config.color,
                thumbnail: {
                    url: `https://images.evetech.net/types/${kill.victim.ship_type_id}/render?size=64`
                },
                fields: [
                    { name: "Victim", value: `${names.finalVictimName} (${names.corpName})`, inline: false },
                    { name: "Ship", value: names.shipName, inline: true },
                    { name: "Value", value: `**${totalValue} ISK**`, inline: true },
                    { name: "System", value: `**[${names.systemName}](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')})**`, inline: true },
                    { name: "Region", value: `**[${names.regionName}](${DOTLAN_BASE}/map/${names.regionName.replace(/ /g, '_')})**`, inline: true },
                    { name: "Final Blow", value: names.finalBlowCorp, inline: true },
                    { name: "Attackers", value: `${names.attackerCount}`, inline: true },
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
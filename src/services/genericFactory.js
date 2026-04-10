const helpers = require('../core/helpers');

const CATEGORY_CONFIG = {
    at_ships:           { label: 'AT Ship Spotted',       color: 0x3fb950 },
    rorqual_activity:   { label: 'Rorqual Spotted',          color: 0xf39c12 },
    all_kills:          { label: 'Loss Mail Detected',   color: 0x4a4a52 },
    officer:            { label: 'Officer Spotted',    color: 0xf39c12 },
    value_1b:           { label: 'Slightly Serious Loss Mail Detected',    color: 0x5dade2 },
    value_10b:          { label: 'Serious Loss Mail Detected',    color: 0x5dade2 },
    value_20b:          { label: 'Very Serious Loss Mail Detected',    color: 0x5dade2 },
    titan_loss:         { label: 'Titan Destroyed',    color: 0x5dade2 },
    super_loss:         { label: 'Super Cap Destroyed',    color: 0x5dade2 },
    pochven:            { label: 'Loss Mail Detected',    color: 0x5dade2 },
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
                author: {
                    name: names.finalVictimName,
                    icon_url: `https://images.evetech.net/characters/${kill.victim.character_id}/portrait?size=64`,
                    url: `https://zkillboard.com/character/${kill.victim.character_id}/`
                },
                title: `${names.finalVictimName} lost a ${names.shipName}`,
                url: `https://zkillboard.com/kill/${kill.killmail_id}/`,
                color: config.color,
                image: {
                    url: `https://images.evetech.net/types/${kill.victim.ship_type_id}/render?size=256`
                },
                thumbnail: {
                    url: `https://edge.socketkill.com/favicon.png`
                },
                fields: [
                    { name: "Value", value: `**${totalValue} ISK**`, inline: false },
                    { name: "System - Region", value: `[**${names.systemName}**](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')}) · [**${names.regionName}**](${DOTLAN_BASE}/map/${names.regionName.replace(/ /g, '_')})`, inline: false },
                    { name: "Report", value: `Final blow: ${names.finalBlowCorp} · ${names.attackerCount} attackers`, inline: false },
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
const helpers = require('../core/helpers');
const { AT_SHIP_IDS, OFFICER_SHIP_IDS, RORQUAL_SHIP_IDS } = require('../core/shipIDs');

const CATEGORY_CONFIG = {
    at_ships: { color: 0xf39c12 },
    rorqual_activity: { color: 0xf39c12 },
    all_kills: { color: 0xff6b6b },
    officer: { color: 0xff6b6b },
    value_1b: { color: 0xff6b6b },
    value_10b: { color: 0xff6b6b },
    value_20b: { color: 0xff6b6b },
    titan_loss: { color: 0xff6b6b },
    super_loss: { color: 0xff6b6b },
    pochven: { color: 0xff6b6b },
    ganks: { color: 0xff6b6b },
};

const DOTLAN_BASE = 'https://evemaps.dotlan.net';
const KILLMAIL_BASE = `https://zkillboard.com/`;
const siteIcon = `https://edge.socketkill.com/favicon.png`;
const API_BASE = `https://api.socketkill.com/render/`;

class NewsEmbedFactory {
    static createEmbed(kill, zkb, names, category) {
        const config = CATEGORY_CONFIG[category] || { color: 0x3fb950 }
        const totalValue = helpers.formatIsk(zkb.totalValue);
        
           const authorIcon = kill.victim.character_id
            ? `https://images.evetech.net/characters/${kill.victim.character_id}/portrait?size=64`
            : `${API_BASE}corp/${kill.victim.corporation_id}`;

        return {
            username: "Socketkill.com",
            avatar_url: siteIcon,
            embeds: [{
                author: {
                    name: `${names.finalVictimName} lost a ${names.shipName}`,
                    icon_url: authorIcon,
                    url: helpers.getSocketKillLink(kill.killmail_id)
                },
                color: config.color,
                thumbnail: {
                    url: `${API_BASE}ship/${kill.victim.ship_type_id}?size=128`
                },
                fields: [
                    { name: "System", value: `**[${names.systemName}](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Region", value: `**[${names.regionName}](${DOTLAN_BASE}/region/${names.regionName.replace(/ /g, '_')})** `, inline: false },
                    {
                        name: "Corporation",
                        value: kill.victim.corporation_id
                            ? `**[${names.corpName}](${KILLMAIL_BASE}corporation/${kill.victim.corporation_id}/)**`
                            : "—",
                        inline: false
                    },
                    {
                        name: "Alliance",
                        value: kill.victim.alliance_id
                            ? `**[${names.allianceName}](${KILLMAIL_BASE}alliance/${kill.victim.alliance_id}/)**`
                            : "—",
                        inline: false
                    },
                    { name: "Final Blow", value: `${names.finalBlowCorp} · ${names.attackerCount} ${names.attackerCount === 1 ? 'attacker' : 'attackers'}`, inline: false },
                    { name: "Value", value: `**${totalValue} ISK**`, inline: false },
                ],
                footer: {
                    text: "Powered by Socketkill.com",
                    icon_url: siteIcon
                },
                timestamp: new Date().toISOString()
            }]
        };
    }


    static createActivityEmbed(kill, zkb, names, category) {
        const config = CATEGORY_CONFIG[category] || { color: 0x3fb950 };
        const triggerAttacker = kill.attackers?.find(a =>
            AT_SHIP_IDS.has(a.ship_type_id) || OFFICER_SHIP_IDS.has(a.ship_type_id) || RORQUAL_SHIP_IDS.has(a.ship_type_id)
        );
        return {
            username: "Socketkill.com",
            avatar_url: siteIcon,
            embeds: [{
                author: {
                    name: `${names.triggerShipName || 'Unknown'} spotted in ${names.systemName}`,
                    icon_url: `${API_BASE}corp/${triggerAttacker?.corporation_id}`,
                    url: helpers.getSocketKillLink(kill.killmail_id)
                },

                thumbnail: { url: `${API_BASE}ship/${names.triggerShipId}?size=256` },
                color: 0xf39c12,
                fields: [
                    { name: "System", value: `**[${names.systemName}](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Region", value: `**[${names.regionName}](${DOTLAN_BASE}/region/${names.regionName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Pilot", value: names.triggerCharName ? `**[${names.triggerCharName}](https://zkillboard.com/character/${triggerAttacker?.character_id}/)**` : 'Unknown', inline: false },
                    { name: "Corporation", value: names.triggerCorpName ? `**[${names.triggerCorpName}](https://zkillboard.com/corporation/${triggerAttacker?.corporation_id}/)**` : 'Unknown', inline: false },
                    {
                        name: "Alliance",
                        value: names.allianceName
                            ? `**[${names.allianceName}](${KILLMAIL_BASE}alliance/${triggerAttacker?.alliance_id}/)**`
                            : "—",
                        inline: false
                    },
                    { name: "Value", value: `**${helpers.formatIsk(zkb.totalValue)} ISK**`, inline: false },
                ],
                footer: {
                    text: `Powered by Socketkill.com`,
                    icon_url: siteIcon
                },
                timestamp: new Date().toISOString()
            }]
        };
    }
}

module.exports = NewsEmbedFactory;
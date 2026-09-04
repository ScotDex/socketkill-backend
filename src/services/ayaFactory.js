
const helpers = require('../core/helpers')

class AyaFactory {
    static createKillEmbed(kill, names, isDeath) {
        const DOTLAN_BASE = 'https://evemaps.dotlan.net'
        const ENTITY_BASE = 'https://socketkill.com';
        const totalValue = helpers.formatIsk(names.rawValue)
        const feedIcon = `https://edge.socketkill.com/podcaro.webp`;
        const authorIcon = kill.victim.character_id
    ? `https://images.evetech.net/characters/${kill.victim.character_id}/portrait?size=128`
    : `https://images.evetech.net/corporations/${kill.victim.corporation_id}/logo?size=128`;

    const headline = isDeath
    ? `Caroline lost a ${names.shipName}`
    : `Caroline killed a ${names.shipName}`;

        return {
            username: "Kill Tracker",
            avatar_url: feedIcon,
            embeds: [{
    author: {
        name: headline,
        url: helpers.getSocketKillLink(kill.killmail_id),
        icon_url: authorIcon
    },
                
                thumbnail: { url: `https://images.evetech.net/types/${kill.victim.ship_type_id}/render?size=256` },
                color: isDeath ? 0xff6b6b : 0x4ade80,
                fields: [
                    { name: "System", value: `**[${names.systemName}](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Region", value: `**[${names.regionName}](${DOTLAN_BASE}/region/${names.regionName.replace(/ /g, '_')})** `, inline: false },
                    {
                        name: "Corporation",
                        value: kill.victim.corporation_id
                            ? `**[${names.corpName}](${ENTITY_BASE}/corp/${kill.victim.corporation_id})**`
                            : "—",
                        inline: false
                    },
                    {
                        name: "Alliance",
                        value: kill.victim.alliance_id
                            ? `**[${names.allianceName}](${ENTITY_BASE}/alliance/${kill.victim.alliance_id})**`
                            : "No Alliance",
                        inline: false
                    },
                    { name: "Final Blow", value: `${names.finalBlowCorp} · ${names.attackerCount} ${names.attackerCount === 1 ? 'attacker' : 'attackers'}`, inline: false },
                    { name: "Total Value", value: `**${totalValue} ISK**`, inline: false },
                ],
                footer: {
                    text: `Powered by SocketKill.com - Fuck Cancer`,
                    icon_url: "https://edge.socketkill.com/favicon.png"
                },
                timestamp: new Date().toISOString()
            }]
        };
    }
}

module.exports = AyaFactory;
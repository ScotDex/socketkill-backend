
const helpers = require('../core/helpers')

const LOSS_COMMENTS = [
    "Another one bites the dust",
    "Should have logged off",
    "Reminder: undocking is optional.",
    "Somewhere a spy is very pleased.",
    "Another generous donation to the killboard.",
    "That was a very loud mistake.",
    "Aggressive asset re-distribution",
    "Masterclass in decision making",
    "Big brain energy detected",
    "Ship died faster than his post-goon clarity",
    "When the goon session lasts longer than your tank",
    "That fit looked better in theory",
    "You’ve successfully reduced server load",
    "At least it wasn't a Titan",
]

class corpIntelFactory {
    static createKillEmbed(kill, zkb, names) {
        const DOTLAN_BASE = 'https://evemaps.dotlan.net'
        const totalValue = helpers.formatIsk(zkb.totalValue)
        const corpIcon = `https://edge.socketkill.com/taylr/logo.png`;
        const title = LOSS_COMMENTS[Math.floor(Math.random() * LOSS_COMMENTS.length)];
        const API_BASE = `https://api.socketkill.com/render/`;

        const authorIcon = kill.victim.character_id
            ? `https://images.evetech.net/characters/${kill.victim.character_id}/portrait?size=128`
            : `${API_BASE}corp/${kill.victim.corporation_id}`;


        return {
            username: "The Shame Bell",
            avatar_url: corpIcon,
            embeds: [{
                author: {
                    name: `${names.finalVictimName} lost a ${names.shipName}`,
                    icon_url: authorIcon
                },
                title: title,
                url: helpers.getSocketKillLink(kill.killmail_id),
                thumbnail: { url: `${API_BASE}ship/${kill.victim.ship_type_id}?size=256` },
                color: 0xff6b6b,
                fields: [
                    { name: "System", value: `**[${names.systemName}](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Region", value: `**[${names.regionName}](${DOTLAN_BASE}/region/${names.regionName.replace(/ /g, '_')})** `, inline: false },
                    { name: "Corporation", value: `**[${names.corpName}](https://zkillboard.com/corporation/${kill.victim.corporation_id}/)**`, inline: false },
                    { name: "Alliance", value: names.allianceName ? `**[${names.allianceName}](https://zkillboard.com/alliance/${kill.victim.alliance_id}/)**` : "No Alliance", inline: false },
                    { name: "Final Blow", value: `${names.finalBlowCorp} · ${names.attackerCount} ${names.attackerCount === 1 ? 'attacker' : 'attackers'}`, inline: false },
                    { name: "Total Value", value: `**${totalValue} ISK**`, inline: false },
                ],
                footer: {
                    text: `Powered by SocketKill.com`,
                    icon_url: "https://edge.socketkill.com/favicon.png"
                },
                timestamp: new Date().toISOString()
            }]
        };
    }
}

module.exports = corpIntelFactory;
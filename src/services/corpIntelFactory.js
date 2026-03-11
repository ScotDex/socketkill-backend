const helpers = require('../core/helpers')

const LOSS_COMMENTS = [
    "Another one bites the dust",
    "Should have logged off",
    "Reminder: undocking is optional.",
    "Somewhere a spy is very pleased.",
    "Another generous donation to the killboard.",
    "That was a very loud mistake."
]

class corpIntelFactory {
    static createKillEmbed(kill, zkb, names) {

        const totalValue = helpers.formatIsk(zkb.totalValue)
        const corpIcon = `https://edge.socketkill.com/taylr/logo.png`;
        const title = LOSS_COMMENTS[Math.floor(Math.random() * KILL_COMMENTS.length)];
        return {
            username: "Wall of Shame Member",
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
                    { name: "System", value: `**${names.systemName}**`, inline: false },
                    { name: "Region", value: names.regionName, inline: false },
                    { name: "Corporation", value: names.corpName, inline: false },
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

const helpers = require('../core/helpers')
const pick = a => a[Math.floor(Math.random() * a.length)];
const API_BASE = `https://api.socketkill.com/render/`;



const KILL_LINES = [
    "Bombeldo casts Fireball. Target deleted.",
];

const DEATH_LINES = [
    "Bombeldo's mana ran dry mid-cast.",
    "Fuck, Fuck, Bugger",
    "At least it wasn't a fortizar this time, or maybe it was..."
];


class bombeldoFactory {
    static createEmbed(kill, zkb, names, isDeath) {
        const headline = isDeath
            ? `Bombeldo the Wizard lost a ${names.shipName}`
            : `Bombeldo the Wizard killed a ${names.shipName}`;

        const subject = isDeath
            ? { name: 'Killed by', value: `${names.finalBlowCorp} · ${names.attackerCount} ${names.attackerCount === 1 ? 'attacker' : 'attackers'}` }
            : { name: 'Victim', value: `${names.finalVictimName} (${names.corpName})` };

        return {
            username: "Bombeldo the Wizard",
            avatar_url: 'https://edge.socketkill.com/wizard.png',
            embeds: [{
                author: {
                    name: headline,
                    url: helpers.getSocketKillLink(kill.killmail_id),
                    icon_url: `${API_BASE}ship/${kill.victim.ship_type_id}?size=64`
                },
                title: isDeath ? pick(DEATH_LINES) : pick(KILL_LINES),
                url: helpers.getSocketKillLink(kill.killmail_id),
                thumbnail: { url: `${API_BASE}ship/${kill.victim.ship_type_id}?size=256` },
                color: isDeath ? 0xff6b6b : 0x9b59b6,
                fields: [
                    subject,
                    { name: 'System', value: `**${names.SystemName}**` },
                    { name: 'Region', value: `**${names.regionName}**` },
                    { name: 'Value', value: `**${helpers.formatIsk(zkb.totalValue)} ISK**`, inline: false },
                    { name: 'Link', value: helpers.getZkillLink(kill.killmail_id) }
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

module.exports = bombeldoFactory;


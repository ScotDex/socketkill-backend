
const helpers = require('../core/helpers')
const pick = a => a[Math.floor(Math.random() * a.length)];
const API_BASE = `https://api.socketkill.com/render/`;
const plexRate = require('../services/plexRate');
const FREDDO_PRICE_GBP = 0.35;
const DOTLAN_BASE = 'https://evemaps.dotlan.net';


// patch for removing static files
const KILL_LINES = [
    "Bombeldo casts Fireball. Target deleted.",
    "I am a 20th level Wizard from the land of Faerûn",
    "Remember and use the code so I can get a freddo",
    "Bazza still crying for attention",
    "Shame bazza can't fly anything shinier",
    "Disguise is working well",
    "Another generous donation to the killboard",
    "Potential shiny pokemen",
    "Fuck Freddo Prices",
    "Deception roll didnt work did it fucker!",
    "Kiss, Kiss, Cuddle...",
    "uWu Daddy",
    "The best eve guide..."
];

const DEATH_LINES = [
    "I am a 20th level Wizard from the land of Faerûn",
    "Fuck, Fuck, Bugger",
    "At least it wasn't a fortizar this time, or maybe it was...",
    "Fuck Snuffed",
    "This one was Elijah's fault...",
    "Still can't say URNs name properly",
    "I was too fucked off about hypernet",
    "Ndbele, ban someone on twitch...",
    "Must be toxicity week in snuffed",
    "Typical washed up bald man",
    "Fuck CVA",
    "Fuck Freddo Prices",
    "Ginger Magician",
    "Snuffed still haven't SRP'd me for this"
];

class bombeldoFactory {
    static createEmbed(kill, zkb, names, isDeath) {
        const headline = isDeath
            ? `Bombeldo lost a ${names.shipName}`
            : `Bombeldo killed a ${names.shipName}`;

        const subject = isDeath
            ? { name: 'Killed by', value: `${names.finalBlowCorp} · ${names.attackerCount} ${names.attackerCount === 1 ? 'attacker' : 'attackers'}` }
            : { name: 'Victim', value: `${names.finalVictimName} (${names.corpName})` };

        const rate = plexRate.get();
        const freddoSuffix = rate
            ? ` · Worth ${Math.floor(zkb.totalValue * rate.gbpPerIsk / FREDDO_PRICE_GBP).toLocaleString()} freddos`
            : '';

        return {
            username: "Harold's Mind",
            avatar_url: "https://edge.socketkill.com/1.0.webp",
            embeds: [{
                author: {
                    name: headline,
                    url: helpers.getSocketKillLink(kill.killmail_id),
                    icon_url: `https://edge.socketkill.com/wizard.png`
                },
                title: isDeath ? pick(DEATH_LINES) : pick(KILL_LINES),
                url: helpers.getSocketKillLink(kill.killmail_id),
                thumbnail: { url: `${API_BASE}ship/${kill.victim.ship_type_id}?size=256` },
                color: isDeath ? 0xff6b6b : 0x9b59b6,
                fields: [
                    subject,
                    { name: "System", value: `**[${names.systemName}](${DOTLAN_BASE}/system/${names.systemName.replace(/ /g, '_')})** `, inline: false },
                    { name: 'Region', value: `**[${names.regionName}](${DOTLAN_BASE}/region/${names.regionName.replace(/ /g, '_')})** `, inline: false },
                    { name: 'Value', value: `**${helpers.formatIsk(zkb.totalValue)} ISK**${freddoSuffix}`, inline: false },
                    { name: "Alliance", value: names.allianceName ? `**[${names.allianceName}](https://zkillboard.com/alliance/${kill.victim.alliance_id}/)**` : "-", inline: false },
                    { name: 'Links', value: `**[zKillboard](${helpers.getZkillLink(kill.killmail_id)})** · **[SocketKill](${helpers.getSocketKillLink(kill.killmail_id)})**` }
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


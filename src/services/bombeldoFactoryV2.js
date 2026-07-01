const helpers = require('../core/helpers');
const pick = a => a[Math.floor(Math.random() * a.length)];
const API_BASE = `https://api.socketkill.com/render/`;
const plexRate = require('../services/plexRate');
const FREDDO_PRICE_GBP = 0.39;
const DOTLAN_BASE = 'https://evemaps.dotlan.net';


// VARIABLES TO ROTATE GIFS
const GIF_COUNT = 7;
const GIF_BASE = 'https://edge.socketkill.com/bombeldo';
const ACCENT_KILL  = 10181046;  
const ACCENT_DEATH = 16739179;  

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

class bombeldoFactoryV2 {
    static createEmbed (kill, zkb, names, isDeath){
        const killLink  = helpers.getSocketKillLink(kill.killmail_id);
        const zkillLink = helpers.getZkillLink(kill.killmail_id);
            const headline = isDeath
            ? `Bombeldo lost a ${names.shipName}`
            : `Bombeldo killed a ${names.shipName}`;
        const flavour = isDeath ? pick(DEATH_LINES) : pick(KILL_LINES);
        const rate = plexRate.get();
        const freddoSuffix = rate
            ? ` · Worth ${Math.floor(zkb.totalValue * rate.gbpPerIsk / FREDDO_PRICE_GBP).toLocaleString()} freddos`
            : '';
        const dotlanSystem = names.systemName.replace(/ /g, '_');
        const dotlanRegion = names.regionName.replace(/ /g, '_');
        const charId = kill.victim?.character_id;
        const victimLines = [
            { type: 10, content: charId
                ? `Victim · [**${names.finalVictimName}**](https://zkillboard.com/character/${charId}/)`
                : `Victim · **${names.finalVictimName}**` },
            { type: 10, content: `Corp · **${names.corpName}**` }
        ];
        if (names.allianceName) {
            const ticker = names.allianceTicker ? ` **[${names.allianceTicker}]**` : '';
            victimLines.push({ type: 10,
                content: `Alliance · [**${names.allianceName}**](https://zkillboard.com/alliance/${kill.victim.alliance_id}/)${ticker}` });
        }
        const gifUrl = `${GIF_BASE}/id-${Math.floor(Math.random() * GIF_COUNT) + 1}.gif`;
        const ts = Math.floor(Date.now() / 1000);
        const inner = [];
        inner.push({
            type: 9,
            components: [
                { type: 10, content: `**${headline}**` },
                { type: 10, content: `[**${flavour}**](${killLink})` },
                { type: 10, content: `Value - **${helpers.formatIsk(zkb.totalValue)} ISK**${freddoSuffix}` }
            ],
            accessory: { type: 11, media: { url: `${API_BASE}ship/${kill.victim.ship_type_id}?size=256` } }
        });

        inner.push({ type: 14, spacing: 1, divider: true });
        if (charId) {
            inner.push({
                type: 9,
                components: victimLines,
                accessory: { type: 11, media: { url: `https://images.evetech.net/characters/${charId}/portrait?size=64` } }
            });
        } else {
            victimLines.forEach(l => inner.push(l));
        }
        if (isDeath) {
            const plural = names.attackerCount === 1 ? 'attacker' : 'attackers';
            inner.push({ type: 10,
                content: `Killed by · **${names.finalBlowCorp}** · ${names.attackerCount} ${plural}` });
        }
        inner.push({ type: 14, spacing: 1, divider: true });
        inner.push({ type: 10,
            content: `System [**${names.systemName}**](${DOTLAN_BASE}/system/${dotlanSystem}) · Region [**${names.regionName}**](${DOTLAN_BASE}/region/${dotlanRegion})` });
        inner.push({ type: 14, spacing: 1, divider: true });
        inner.push({ type: 12, items: [{ media: { url: gifUrl }, description: 'kill gif' }] });
        inner.push({
            type: 1,
            components: [
                { type: 2, style: 5, label: 'zKillboard', url: zkillLink },
                { type: 2, style: 5, label: 'SocketKill', url: killLink },
                { type: 2, style: 5, label: 'Twitch', url: 'https://twitch.tv/BombeldoTheWizard' }
            ]
        });
        inner.push({ type: 10, content: `-# Powered by [SocketKill.com](https://socketkill.com) · <t:${ts}:R>` });
        return {
            username: "Harold's Mind",
            avatar_url: "https://edge.socketkill.com/harold.webp",
            flags: 32768,
            components: [
                { type: 17, accent_color: isDeath ? ACCENT_DEATH : ACCENT_KILL, components: inner }
            ]
        };
    }
}
module.exports = bombeldoFactoryV2;
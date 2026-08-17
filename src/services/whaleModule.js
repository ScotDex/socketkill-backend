const { TwitterService, BlueSkyService } = require("../network/twitterService");
const CorpIntelFactory = require("../services/corpIntelFactory");
const axios = require("../network/agent");
const helpers = require("../core/helpers");
const atOfficerFactory = require("./atOfficerFactory");
const { AT_SHIP_IDS, OFFICER_SHIP_IDS, RORQUAL_SHIP_IDS } = require('../core/shipIDs');
const { TITAN_SHIP_IDS, SUPER_SHIP_IDS, TRIGLAVIAN_SYSTEMS } = require('../core/relayShipIDs');
const r2 = require("../network/r2Writer");
const NewsEmbedFactory = require("./genericFactory");
const bombeldoFactory = require('./bombeldoFactoryV2');
const { renderOgCard } = require('../services/ogCard');

let channels = {};

const WHALE_THRESHOLD = 40000000000;
const VALUE_1B = 1000000000;
const VALUE_10B = 10000000000;
const VALUE_100M = 100_000_000;



const BOMBELDO_TRACKED_CHARACTERS = [
    909008587,
];


async function loadChannels() {
    try {
        const config = await r2.get('channels.json');
        if (config) channels = config;
        console.log(`[NEWS] Loaded ${Object.keys(channels).length} channel categories`);
    } catch (err) {
        console.error(`[NEWS] Failed to load channels.json: ${err.message}`);
    }
}

loadChannels();


const MIN_WEBHOOK_INTERVAL_MS = 1100;
let webhookQueue = Promise.resolve();

function webhookSpacer() {
    const next = webhookQueue.then(() => new Promise(r => setTimeout(r, MIN_WEBHOOK_INTERVAL_MS)));
    webhookQueue = next;
    return next;
}

const TRACKER_CATEGORIES = new Set(['officer', 'at_ships', 'rorqual_activity']);

async function postNewsChannel(kill, names, category) {
    const urls = channels[category];
    if (!urls || urls.length === 0) return;
    const urlList = Array.isArray(urls) ? urls : [urls];

    const payload = TRACKER_CATEGORIES.has(category)
        ? NewsEmbedFactory.createActivityEmbed(kill, names, category)
        : NewsEmbedFactory.createEmbed(kill, names, category);


        const results = await Promise.all(
        urlList.map(async url => {
            await webhookSpacer();
            const finalUrl = payload.flags === 32768 ? `${url}?with_components=true` : url;
            return axios.post(finalUrl, payload)
                .then(() => true)
                .catch(err => {
                    console.error(`[NEWS] ${category} webhook failed: ${err.message}`);
                    return false;
                });
        })
    );
    const ok = results.filter(Boolean).length;
    console.log(`[RELAY FIRING] Kill ${kill.killmail_id} posted to ${category} (${ok}/${urlList.length} webhooks)`);
}

module.exports = async (killmail, names) => {
    const isOfficerKill = killmail.attackers?.some(a => OFFICER_SHIP_IDS.has(a.ship_type_id));
    const isATKill = killmail.attackers?.some(a => AT_SHIP_IDS.has(a.ship_type_id))
    const isRorqual = killmail.attackers?.some(a => RORQUAL_SHIP_IDS.has(a.ship_type_id))

    if (isOfficerKill || isATKill || isRorqual) {
        await postOfficerIntel(killmail, names);
        await new Promise(resolve => setTimeout(resolve, 2000));
    }


    // Centralized Dispatcher
    const categoryPosts = [];
    if (isOfficerKill) categoryPosts.push(postNewsChannel(killmail, names, 'officer'));
    if (isATKill) categoryPosts.push(postNewsChannel(killmail,  names, 'at_ships'));
    if (isRorqual) categoryPosts.push(postNewsChannel(killmail,  names, 'rorqual_activity'));
    if (names.rawValue >= VALUE_1B) categoryPosts.push(postNewsChannel(killmail,  names, 'value_1b'));
    if (names.rawValue >= VALUE_10B) categoryPosts.push(postNewsChannel(killmail,  names, 'value_10b'));
    if (names.rawValue >= VALUE_100M) categoryPosts.push(postNewsChannel(killmail,  names, 'all_kills'));
    if (TITAN_SHIP_IDS.has(killmail.victim?.ship_type_id)) categoryPosts.push(postNewsChannel(killmail,  names, 'titan_loss'));
    if (SUPER_SHIP_IDS.has(killmail.victim?.ship_type_id)) categoryPosts.push(postNewsChannel(killmail,  names, 'super_loss'));
    if (TRIGLAVIAN_SYSTEMS.has(killmail.solar_system_id)) categoryPosts.push(postNewsChannel(killmail, names, 'pochven'));
    if (names.space === 'high') categoryPosts.push(postNewsChannel(killmail,  names, 'ganks'));

    // Bombeldo Block of Code

    const victimId = killmail.victim?.character_id;
    const isBombeldoDeath = BOMBELDO_TRACKED_CHARACTERS.includes(victimId);
    const isBombeldoKill = !isBombeldoDeath && killmail.attackers?.some(a => BOMBELDO_TRACKED_CHARACTERS.includes(a.character_id));

    if (isBombeldoDeath || isBombeldoKill) {
        categoryPosts.push(postBombeldo(killmail,  names, isBombeldoDeath));
    }

    // End Bombeldo Block of Code


    if (categoryPosts.length) await Promise.all(categoryPosts);

    if (names.rawValue < WHALE_THRESHOLD) return;
    await Promise.all([
        postNewsChannel(killmail, names, 'value_20b'),
        postCorpIntel(killmail,  names),
        postSocial(killmail, names, helpers.formatIsk(names.rawValue), killmail.killmail_id)
    ]);
};


// Bombeldo Posts Function
// This function will post the killmail to the Bombeldo Discord channel

async function postBombeldo(kill,  names, isDeath) {
    const urls = channels['bombeldo'];
    if (!urls?.length) return;
    const list = Array.isArray(urls) ? urls : [urls];
    const payload = bombeldoFactory.createEmbed(kill,  names, isDeath);
    await Promise.all(list.map(async (url) => {
        await webhookSpacer();
        const finalUrl = payload.flags === 32768 ? `${url}?with_components=true` : url;
        return axios.post(finalUrl, payload).catch((err) =>
            console.error(`[BOMBELDO] webhook failed: ${err.message}`));
            console.error(`[BOMBELDO] detail:`, JSON.stringify(err.response?.data));
    }));
}

// End Bombeldo Posts Function


async function postCorpIntel(kill,  names) {
    console.log(`[CORP INTEL] Firing for kill ${kill.killmail_id} | rawValue: ${names.rawValue}`);
    const payload = CorpIntelFactory.createKillEmbed(kill, names);
    try {
        await axios.post(process.env.BLANKSPACE_HOOK, payload);
        console.log(`[BLANKSPACE PAYLOAD FIRING] Kill ${kill.killmail_id} posted`);
    } catch (err) {
        console.error(`[BLANKSPACE PAYLOAD FAILED] Webhook failed: ${err.message}`);
    }
}

async function postOfficerIntel(kill,  names) {
    const payload = atOfficerFactory.createKillEmbed(kill, names);
    try {
        await Promise.all([
            axios.post(process.env.INTEL_WEBHOOK_URL, payload),
            axios.post(process.env.SECOND_HOOK, payload)
        ])
        console.log(`[BLANKSPACE AT SHIP PAYLOAD FIRING] Kill ${kill.killmail_id} posted`);
    } catch (err) {
        console.error(`[BLANKSPACE AT SHIP PAYLOAD FAILED] Webhook failed: ${err.message}`);
    }
}

async function postSocial(killmail, names, formattedValue, killmailId) {
    let png = null;
    try {
        png = await renderOgCard({
            victim: {
                name: names.finalVictimName,
                ship: names.shipName,
                shipTypeID: killmail.victim.ship_type_id,
            },
            totalValue: formattedValue,
            rawValue: names.rawValue,
            system: {
                name: names.systemName,
                region: names.regionName,
                security: names.securityStatus,
                id: killmail.solar_system_id,
            },
        });
    } catch (err) {
        console.error(`[SOCIAL] Card render failed, posting text-only: ${err.message}`);
    }
    await Promise.all([
        TwitterService.postWhale(names, formattedValue, killmailId, png),
        BlueSkyService.postWhale(names, formattedValue, killmailId, png),
    ]);
}
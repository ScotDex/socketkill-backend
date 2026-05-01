const { TwitterService, BlueSkyService } = require("../network/twitterService");
const CorpIntelFactory = require("../services/corpIntelFactory");
const axios = require("../network/agent");
const helpers = require("../core/helpers");
const atOfficerFactory = require("./atOfficerFactory");
const { AT_SHIP_IDS, OFFICER_SHIP_IDS, RORQUAL_SHIP_IDS } = require('../core/shipIDs');
const { TITAN_SHIP_IDS, SUPER_SHIP_IDS, TRIGLAVIAN_SYSTEMS } = require('../core/relayShipIDs');
const r2 = require("../network/r2Writer");
const NewsEmbedFactory = require("./genericFactory");

let channels = {};

const WHALE_THRESHOLD = 20000000000;
const VALUE_1B = 1000000000;
const VALUE_10B = 10000000000;
const VALUE_100M = 100_000_000;

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
let lastWebhookAt = 0;

async function webhookSpacer() {
    const now = Date.now();
    const wait = lastWebhookAt + MIN_WEBHOOK_INTERVAL_MS - now;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastWebhookAt = Date.now();
}

const TRACKER_CATEGORIES = new Set(['officer', 'at_ships', 'rorqual_activity']);

async function postNewsChannel(kill, zkb, names, category) {
    const urls = channels[category];
    if (!urls || urls.length === 0) return;
    const urlList = Array.isArray(urls) ? urls : [urls];

    const payload = TRACKER_CATEGORIES.has(category)
        ? NewsEmbedFactory.createActivityEmbed(kill, zkb, names, category)
        : NewsEmbedFactory.createEmbed(kill, zkb, names, category);


    await Promise.all(
        urlList.map(async url => {
            await webhookSpacer();
            const finalUrl = payload.flags === 32768 ? `${url}?with_components=true` : url;
            return axios.post(finalUrl, payload).catch(err =>
                console.error(`[NEWS] ${category} webhook failed: ${err.message}`)
            )
        })
    );
    console.log(`[RELAY FIRING] Kill ${kill.killmail_id} posted to ${category} (${urlList.length} webhooks)`);
}

module.exports = async (killmail, zkb, names) => {
    const isOfficerKill = killmail.attackers?.some(a => OFFICER_SHIP_IDS.has(a.ship_type_id));
    const isATKill = killmail.attackers?.some(a => AT_SHIP_IDS.has(a.ship_type_id))
    const isRorqual = killmail.attackers?.some(a => RORQUAL_SHIP_IDS.has(a.ship_type_id))

    if (isOfficerKill || isATKill || isRorqual) {
        await postOfficerIntel(killmail, zkb, names);
        await new Promise(resolve => setTimeout(resolve, 2000));
    }


    // Centralized Dispatcher
    const categoryPosts = [];
    if (isOfficerKill) categoryPosts.push(postNewsChannel(killmail, zkb, names, 'officer'));
    if (isATKill) categoryPosts.push(postNewsChannel(killmail, zkb, names, 'at_ships'));
    if (isRorqual) categoryPosts.push(postNewsChannel(killmail, zkb, names, 'rorqual_activity'));
    if (names.rawValue >= VALUE_1B) categoryPosts.push(postNewsChannel(killmail, zkb, names, 'value_1b'));
    if (names.rawValue >= VALUE_10B) categoryPosts.push(postNewsChannel(killmail, zkb, names, 'value_10b'));
    if (names.rawValue >= VALUE_100M) categoryPosts.push(postNewsChannel(killmail, zkb, names, 'all_kills'));
    if (TITAN_SHIP_IDS.has(killmail.victim?.ship_type_id)) categoryPosts.push(postNewsChannel(killmail, zkb, names, 'titan_loss'));
    if (SUPER_SHIP_IDS.has(killmail.victim?.ship_type_id)) categoryPosts.push(postNewsChannel(killmail, zkb, names, 'super_loss'));
    if (TRIGLAVIAN_SYSTEMS.has(killmail.solar_system_id)) categoryPosts.push(postNewsChannel(killmail, zkb, names, 'pochven'));
    if (zkb.labels?.includes('ganked')) categoryPosts.push(postNewsChannel(killmail, zkb, names, 'ganks'));
    if (categoryPosts.length) await Promise.all(categoryPosts);

    if (names.rawValue < WHALE_THRESHOLD) return;
    await Promise.all([
        postNewsChannel(killmail, zkb, names, 'value_20b'),
        postCorpIntel(killmail, zkb, names),
        postSocial(names, helpers.formatIsk(names.rawValue), killmail.killmail_id)
    ]);
};

async function postCorpIntel(kill, zkb, names) {
    console.log(`[CORP INTEL] Firing for kill ${kill.killmail_id} | rawValue: ${names.rawValue}`);
    const payload = CorpIntelFactory.createKillEmbed(kill, zkb, names);
    try {
        await axios.post(process.env.BLANKSPACE_HOOK, payload);
        console.log(`[BLANKSPACE 20BILL PAYLOAD FIRING] Kill ${kill.killmail_id} posted`);
    } catch (err) {
        console.error(`[BLANKSAPCE 20BILL PAYLOAD FAILED] Webhook failed: ${err.message}`);
    }
}

async function postOfficerIntel(kill, zkb, names) {
    const payload = atOfficerFactory.createKillEmbed(kill, zkb, names);
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

async function postSocial(names, formattedValue, killmailId) {
    const results = await Promise.allSettled([
        TwitterService.postWhale(names, formattedValue, killmailId),
        BlueSkyService.postWhale(names, formattedValue, killmailId)
    ]);
    results.forEach((r, i) => {
        if (r.status === 'rejected') {
            const platform = i === 0 ? 'Twitter' : 'Bluesky';
            console.error(`[SOCIAL] ${platform} post failed for kill ${killmailId}: ${r.reason?.message}`);
        }
    });
}
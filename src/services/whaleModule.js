const { TwitterService, BlueSkyService } = require("../network/twitterService");
const CorpIntelFactory = require("../services/corpIntelFactory");
const axios = require("../network/agent");
const helpers = require("../core/helpers");
const atOfficerFactory = require("./atOfficerFactory");
const { AT_SHIP_IDS, OFFICER_SHIP_IDS, RORQUAL_SHIP_IDS } = require('../core/shipIDs');
const r2 = require("../network/r2Writer");
const NewsEmbedFactory = require("./genericFactory");

let channels = {};

const WHALE_THRESHOLD = 20000000000;

async function loadChannels() {
    try {
        const config = await r2.get('channels.json');
        if (config) channels = config;
        console.log (`[NEWS] Loaded ${Object.keys(channels).length} channel categories`);
    } catch (err) {
        console.error(`[NEWS] Failed to load channels.json: ${err.message}`);
    }
}

loadChannels();

async function postNewsChannel(kill, zkb, names, category) {
    const urls = channels[category];
    if (!urls || urls.length === 0) return;
    const urlList = Array.isArray(urls) ? urls : [urls];
    const payload = NewsEmbedFactory.createEmbed(kill, zkb, names, category);
    await Promise.all(
        urlList.map(url => axios.post(url, payload).catch(err =>
            console.error(`[NEWS] ${category} webhook failed: ${err.message}`)
        ))
    );
    console.log(`[NEWS] Kill ${kill.killmail_id} posted to ${category} (${urlList.length} webhooks)`);
}

module.exports = async (killmail, zkb, names) => {
    const isOfficerKill = killmail.attackers?.some(a => OFFICER_SHIP_IDS.has(a.ship_type_id));
    const isATKill = killmail.attackers?.some(a => AT_SHIP_IDS.has(a.ship_type_id))
    const isRorqual = killmail.attackers?.some(a => RORQUAL_SHIP_IDS.has(a.ship_type_id))

    await postNewsChannel(killmail, zkb, names, 'test');
    await new Promise (resolve => setTimeout(resolve, 3000))

    if (isOfficerKill || isATKill || isRorqual) {
    await postOfficerIntel(killmail, zkb, names);
    await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (names.rawValue < WHALE_THRESHOLD) return;
    await Promise.all([
        postCorpIntel(killmail, zkb, names),
        postSocial(names, helpers.formatIsk(names.rawValue), killmail.killmail_id)
    ]);
};

async function postCorpIntel(kill, zkb, names) {
    const payload = CorpIntelFactory.createKillEmbed(kill, zkb, names);
    try {
        await axios.post(process.env.BLANKSPACE_HOOK, payload),
        console.log(`[CORP INTEL] Kill ${kill.killmail_id} posted`);
    } catch (err) {
        console.error(`[CORP INTEL] Webhook failed: ${err.message}`);
    }
}

async function postOfficerIntel(kill, zkb, names) {
    const payload = atOfficerFactory.createKillEmbed(kill, zkb, names);
    try {
        await Promise.all([
            axios.post(process.env.INTEL_WEBHOOK_URL, payload),
            axios.post(process.env.SECOND_HOOK, payload)
        ])
        console.log(`[OFFICER HOOK INTEL] Kill ${kill.killmail_id} posted`);
    } catch (err) {
        console.error(`[OFFICER HOOK INTEL] Webhook failed: ${err.message}`);
    }
}

async function postSocial(names, formattedValue, killmailId) {
    try {
        await Promise.all([
            TwitterService.postWhale(names, formattedValue, killmailId),
            BlueSkyService.postWhale(names, formattedValue, killmailId)
        ]);
    } catch (err) {
        console.error(`[SOCIAL] Post failed: ${err.message}`);
    }
}
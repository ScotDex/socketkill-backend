const { TwitterService, BlueSkyService } = require("../network/twitterService");
const CorpIntelFactory = require("../services/corpIntelFactory");
const axios = require("../network/agent");
const helpers = require("../core/helpers");
const atOfficerFactory = require("./atOfficerFactory");
const { OFFICER_SHIP_IDS } = require ("../core/officerIDs");

const WHALE_THRESHOLD = 20000000000;

module.exports = async (killmail, zkb, names) => {
    const isOfficerKill = killmail.attackers?.some(a => OFFICER_SHIP_IDS.has(a.ship_type_id));

    if (isOfficerKill) {
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
        await axios.post(process.env.BLANKSPACE_HOOK, payload);
        console.log(`[CORP INTEL] Kill ${kill.killmail_id} posted`);
    } catch (err) {
        console.error(`[CORP INTEL] Webhook failed: ${err.message}`);
    }
}

async function postOfficerIntel(kill, zkb, names) {
    const payload = atOfficerFactory.createKillEmbed(kill, zkb, names);
    try {
        await axios.post(process.env.INTEL_WEBHOOK_URL, payload);
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
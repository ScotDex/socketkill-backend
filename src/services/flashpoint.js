const { TwitterService, BlueSkyService, MastodonService } = require('../network/twitterService');
const helpers = require('../core/helpers');
const THRESHOLD   = 150;          
const WINDOW_MS   = 15 * 60_000;  
const COOLDOWN_MS = 60 * 60_000;  
const POSTING_ENABLED = true;

const recent = new Map();     
const lastFired = new Map();  

async function postFlashpoint(systemName, count, isk, firstT, lastT) {
    const url = `https://socketkill.com/?system=${encodeURIComponent(systemName)}`;
    const fmt = ms => new Date(ms).toISOString().slice(11, 16);
    const timeRange = `${fmt(firstT)}–${fmt(lastT)} EVE`;
    const text = `FLASHPOINT: ${systemName} | ${timeRange} | ${count} kills in ${WINDOW_MS / 60000} min | ${helpers.formatIsk(isk)} ISK destroyed`;

    await Promise.all([
        TwitterService.postText(`${text} ${url} #TweetFleet #eveonline #SocketKill`),
        BlueSkyService.postText(`${text} #EveOnline #SocketKill`, url, `Flashpoint: ${systemName}`),
        MastodonService.postText(`${text} ${url} #EveOnline #SocketKill #TweetFleet`),
    ]);
}

function trackKill(killmail, names) {
    const now = Date.now();
    const killTime = Date.parse(killmail.killmail_time);
    if (!Number.isFinite(killTime) || now - killTime > WINDOW_MS) return;

    const id = killmail.solar_system_id;
    const cutoff = now - WINDOW_MS;
    const entries = (recent.get(id) || []).filter(e => e.t >= cutoff);
    if (entries.some(e => e.kid === killmail.killmail_id)) return;
    entries.push({ t: killTime, isk: names.rawValue || 0, kid: killmail.killmail_id });
    recent.set(id, entries);

    if (entries.length < THRESHOLD) return;
    if (now - (lastFired.get(id) || 0) < COOLDOWN_MS) return;

    lastFired.set(id, now);
    const isk = entries.reduce((sum, e) => sum + e.isk, 0);
    const firstT = Math.min(...entries.map(e => e.t));
    const lastT  = Math.max(...entries.map(e => e.t));
    console.log(`[FLASHPOINT] WOULD FIRE: ${names.systemName} (${id}) | ${entries.length} kills / ${WINDOW_MS / 60000}min | ${isk} ISK`);
    if (!POSTING_ENABLED) return;
    if (names.systemName === 'Unknown System') return;
    postFlashpoint(names.systemName, entries.length, isk, firstT, lastT)
        .catch(err => console.error(`[FLASHPOINT] Post failed: ${err.message}`));
}

setInterval(() => {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [id, entries] of recent) {
        if (!entries.some(e => e.t >= cutoff)) recent.delete(id);
    }
}, 5 * 60_000).unref();

module.exports = { trackKill };
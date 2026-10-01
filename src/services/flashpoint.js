const THRESHOLD   = 3;          
const WINDOW_MS   = 15 * 60_000;  
const COOLDOWN_MS = 60 * 60_000;  

const recent = new Map();     
const lastFired = new Map();  

function trackKill(killmail, names) {
    const now = Date.now();
    const killTime = Date.parse(killmail.killmail_time);
    if (!Number.isFinite(killTime) || now - killTime > WINDOW_MS) return;

    const id = killmail.solar_system_id;
    const cutoff = now - WINDOW_MS;
    const entries = (recent.get(id) || []).filter(e => e.t >= cutoff);
    if (entries.some(e => e.kid === killmail.killmail_id)) return;
    entries.push({ t: killTime, isk: names.rawValue || 0 });
    recent.set(id, entries);

    if (entries.length < THRESHOLD) return;
    if (now - (lastFired.get(id) || 0) < COOLDOWN_MS) return;

    lastFired.set(id, now);
    const isk = entries.reduce((sum, e) => sum + e.isk, 0);
    console.log(`[FLASHPOINT] WOULD FIRE: ${names.systemName} (${id}) | ${entries.length} kills / ${WINDOW_MS / 60000}min | ${isk} ISK`);
}

setInterval(() => {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [id, entries] of recent) {
        if (!entries.some(e => e.t >= cutoff)) recent.delete(id);
    }
}, 5 * 60_000).unref();

module.exports = { trackKill };
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_DATABASE_ID;
const TOKEN = process.env.D1_API_TOKEN;
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`;

const ATTACKER_CHUNK = 20; // conservative vs D1 bound-param limits

async function query(sql, params = []) {
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql, params })
    });
    const json = await res.json();
    if (!json.success) throw new Error(JSON.stringify(json.errors));
    return json;
}

async function pruneOldKills(days = 30) {
    const cutoff = `datetime('now', '-${days} days')`;
    await query(
        `DELETE FROM kill_attackers WHERE kill_id IN (SELECT kill_id FROM kills WHERE kill_time < ${cutoff})`
    );
    const res = await query(`DELETE FROM kills WHERE kill_time < ${cutoff}`);
    console.log(`[D1] Pruned kills older than ${days}d`);
    return res;
}

async function recordKill(kill, attackers) {
    await query(
        `INSERT OR IGNORE INTO kills
         (kill_id, hash, kill_time, system_id, region_id, space, total_value,
          victim_character_id, victim_corp_id, victim_alliance_id, ship_type_id, attacker_count)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [kill.killID, kill.hash, kill.time, kill.systemID, kill.regionID, kill.space,
        kill.totalValue, kill.victimCharacterID, kill.victimCorpID,
        kill.victimAllianceID, kill.shipID, kill.attackerCount]
    );

    for (let i = 0; i < attackers.length; i += ATTACKER_CHUNK) {
        const chunk = attackers.slice(i, i + ATTACKER_CHUNK);
        const placeholders = chunk.map(() => '(?,?,?,?,?)').join(',');
        const params = chunk.flatMap(a =>
            [kill.killID, a.character_id, a.corporation_id ?? null, a.alliance_id ?? null, a.final_blow ? 1 : 0]);
        await query(
            `INSERT OR IGNORE INTO kill_attackers (kill_id, character_id, corp_id, alliance_id, final_blow) VALUES ${placeholders}`,
            params
        );
    }
}

module.exports = { recordKill, query, pruneOldKills };
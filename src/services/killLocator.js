// Finds where a kill lives: its date and (when known) its hash.
// Nothing in here sends HTTP responses.

const axios = require("../network/agent");
const r2 = require("../network/r2Writer");
const hashCache = require("../state/hashCache");
const hashIndex = require("../state/hashIndex");
const killmailCache = require("../state/killmailCache");
const helpers = require("./helpers");

// Looks in hashCache, then R2, then the hash index.
// Returns { date, hash } or null if the kill is not known locally.
async function findKillLocally(id) {
  if (hashCache.get(id)) {
    return { date: helpers.todayUTC(), hash: null };
  }

  const km = await r2.get(`killmails/${id}.json`).catch(() => null);
  if (km?.killmail_time) {
    const date = km.killmail_time.slice(0, 10);
    console.log(`[KILL API] DIRECT date for ${id}: ${date}`);
    return { date, hash: null };
  }

  const idxHash = await hashIndex.getHashById(id);
  if (idxHash) {
    try {
      const kmIdx = await killmailCache.get(id, idxHash);
      if (kmIdx?.killmail_time) {
        const date = kmIdx.killmail_time.slice(0, 10);
        console.log(`[KILL API] INDEX date for ${id}: ${date}`);
        return { date, hash: idxHash };
      }
    } catch (err) {
      console.warn(
        `[KILL API] Index hash unresolvable for ${id}: ${err.message}`,
      );
    }
  }

  return null;
}

// Asks zKill for the hash, then fetches the killmail.
// Returns { date, hash } on success or { error: "message" } on failure.
//
// NOT GATED. Callers must pass the bot check, Turnstile and zkillLimit
// before calling this. See handleKillDetail in the web server.
async function recoverFromZkill(id) {
  try {
    const zkillRes = await axios.get(
      `https://zkillboard.com/api/killID/${id}/`,
      { timeout: 3000 },
    );
    const hash = zkillRes.data?.[0]?.zkb?.hash;
    if (!hash) {
      return { error: "Kill not found - Check Zkill URL" };
    }

    const km = await killmailCache.get(id, hash);
    if (!km?.killmail_time) {
      return { error: "Kill hash sourced but killmail unavailable." };
    }

    const date = km.killmail_time.slice(0, 10);
    console.log(`[KILL API] Failover recovered ${id} via zkill, date=${date}`);
    return { date, hash };
  } catch (err) {
    console.warn(`[KILL API] Failover failed for ${id}: ${err.message}`);
    return {
      error: "Kill not found in last 30 days or cache. Check Zkill URL",
    };
  }
}

module.exports = { findKillLocally, recoverFromZkill };
require("dotenv").config({ quiet: true });
const talker = require("./src/network/agent");
const path = require("path");
const esi = require("./src/network/esi");
const startWebServer = require("./src/services/webServer");
const normalizer = require("./src/core/normalizer");
const utils = require("./src/core/helpers");
const statsManager = require("./src/services/statsManager");
const ProcessorFactory = require("./src/core/processor_v2");
const r2 = require("./src/network/r2Writer");
const hashCache = require("./src/state/hashCache")
const { syncMarketPrices, loadMarketPrices } = require("./src/services/priceService");
const kv = require('./src/network/kvClient');
const reactionsManager = require("./src/services/reactionsManager");

const R2_BASE_URL = process.env.R2_BASE_URL;
const SEQUENCE_CACHE_URL = `${R2_BASE_URL}/sequence.json`;
const NEBULA_ROTATION_MS = 10 * 60 * 1000;

// R2Z2 spec-compliant timings
const POLL_DELAY_MS = 100;        // 100ms between successful fetches (spec: 10 req/s max)
const STALL_DELAY_MS = 6000;      // 6s on 404 — spec mandated minimum
const ERROR_DELAY_MS = 5000;      // generic error backoff
const THROTTLE_DELAY_MS = 120000; // 2m on 429
const GHOST_SKIP_AFTER = 5;       // skip a sequence after N normalizer failures
const DEDUP_MAX = 5000;           // dedup set ceiling before pruning
const MAX_KILL_AGE_MS = 24 * 60 * 60 * 1000;
const STATE_PERSIST_INTERVAL = 50;


const state = {
  sequence: 0,
  isThrottled: false,
  lastErrorStatus: null,
  consecutive404s: 0,
  lastSuccessfulIngest: Date.now(),
};


const { io, app } = startWebServer(esi, statsManager, state, () => processor);

const startMonitor = require("./src/network/monitor");
startMonitor(750);

let currentSpaceBg = null;
let processor = null;

io.on("connection", async (socket) => {
  const ip = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
  const ua = socket.handshake.headers["user-agent"] || "Unknown";
  const ref = socket.handshake.headers["referer"] || "Direct";
  console.log(`[NETWORK] New connection: ${socket.id} | IP: ${ip} | UA: ${ua} | Ref: ${ref} | Active: ${io.engine.clientsCount}`);

  if (currentSpaceBg) {
    socket.emit("nebula-update", currentSpaceBg);
  } else {
    refreshNebulaBackground();
  }

  socket.emit("region-list", Object.values(esi.staticRegionData || {}).map(r => r.name).sort());
  socket.emit("gatekeeper-stats", {
    totalScanned: statsManager.getTotal(),
    totalIsk: statsManager.totalIsk,
  });

  const playerCount = await utils.getPlayerCount();
  if (playerCount) socket.emit("player-count", playerCount);
});


async function refreshNebulaBackground() {
  const data = await utils.getBackPhoto();
  if (data) {
    currentSpaceBg = data;
    io.emit("nebula-update", data);
    console.log(`[NEBULA] Background synced: ${data.name}`);
  }
}



async function syncPlayerCount() {
  const status = await utils.getPlayerCount();
  if (status) io.emit("player-count", status);
}



const processedKills = new Set();

function processKill(r2Package) {
  const killTime = new Date(r2Package.esiData?.killmail_time).getTime();

  if (Date.now() - killTime > MAX_KILL_AGE_MS) { // 24h old limit for duplication prevention
    console.warn(`[OLD_MAIL] Discarding ${r2Package.killID} — age ${((Date.now() - killTime) / 1000).toFixed(0)}s`);
    return;
  }

  if (processedKills.has(r2Package.killID)) return;

  processedKills.add(r2Package.killID); // Rolling buffer update
  if (processedKills.size > DEDUP_MAX) processedKills.delete(processedKills.values().next().value);

  processor.processPackage(r2Package);

  const ingestDelay = ((Date.now() - killTime) / 1000).toFixed(1);
  console.log(`[INGEST] Kill ${r2Package.killID} | Age: ${ingestDelay}s`);
}

async function handleSequenceUpdate(sequenceId) {
  try {
    const res = await talker.get(`${R2_BASE_URL}/${sequenceId}.json`, { timeout: 2000 });
    const pkg = normalizer.fromR2(res.data);
    if (pkg?.killID && !processedKills.has(pkg.killID)) {
      processedKills.add(pkg.killID);
      processor.processPackage(pkg);
      console.log(`[REFETCH] Reprocessed updated sequence ${sequenceId}`);
    }
  } catch (e) {
    console.error(`[REFETCH] Failed for sequence ${sequenceId}:`, e.message);
  }
}


let ghostStreak = 0; 
async function prime() {
  try {
    const saved = await r2.get("worker_state.json");
    if (saved?.sequence) {
      console.log(`[PRIME] Found saved sequence ${saved.sequence} — validating...`);
      const testUrl = `${R2_BASE_URL}/${saved.sequence}.json`;
      try {
        await talker.get(testUrl, { timeout: 2000 });
        state.sequence = saved.sequence;
        console.log(`[PRIME] Validated Resumed from saved sequence ${saved.sequence}`);
        return;
      } catch (e) {
        if (e.response?.status === 404) {
          console.warn(`[PRIME] Saved sequence ${saved.sequence} is a gap — falling back to sequence.json`);
        } else {
          state.sequence = saved.sequence;
          console.error(`[PRIME] Failed to validate saved sequence ${saved.sequence}:`, e.message);
          return;
        }
      }
    }
  } catch (_) {
  }

  const res = await talker.get(SEQUENCE_CACHE_URL, { timeout: 5000 });
  if (!res.data?.sequence) throw new Error("Invalid sequence.json payload");

  state.sequence = parseInt(res.data.sequence) - 5;
  console.log(`[PRIME] Cold start from sequence.json at ${state.sequence}`);
}

async function poll() {
  if (state.isThrottled) return;

  const url = `${R2_BASE_URL}/${state.sequence}.json`;
  let nextDelay = POLL_DELAY_MS;

  try {
    const response = await talker.get(url, { timeout: 2000 });
    const r2Package = normalizer.fromR2(response.data);

    if (r2Package?.killID) {
      processKill(r2Package);
      if (r2Package.sequenceUpdated) {
        handleSequenceUpdate(r2Package.sequenceUpdated);
      }

      ghostStreak = 0;
      state.consecutive404s = 0;
      state.lastSuccessfulIngest = Date.now();
      state.lastErrorStatus = 200;
      state.sequence++;

      if (state.sequence % STATE_PERSIST_INTERVAL === 0) {
        r2.put("worker_state.json", { sequence: state.sequence });
      }

      nextDelay = POLL_DELAY_MS;
    } else {
      ghostStreak++;
      if (ghostStreak >= GHOST_SKIP_AFTER) {
        console.warn(`[SKIP] Seq ${state.sequence} — ${GHOST_SKIP_AFTER} consecutive ghost files. Advancing.`);
        state.sequence++;
        ghostStreak = 0;
      } else {
        console.log(`[GAP] Ghost file at seq ${state.sequence} (attempt ${ghostStreak}/${GHOST_SKIP_AFTER})`);
        nextDelay = STALL_DELAY_MS;
      }
    }
  } catch (err) {
    const status = err.response?.status;
    state.lastErrorStatus = status;

    if (status === 429) {
      state.isThrottled = true;
      console.error(`[429] Rate limited. Pausing for ${THROTTLE_DELAY_MS / 1000}s.`);
      setTimeout(() => {
        state.isThrottled = false;
        poll();
      }, THROTTLE_DELAY_MS);
      return; 
    }

    if (status === 404) {
      state.consecutive404s++;
      if (state.consecutive404s === 1 || state.consecutive404s % 10 === 0) {
        console.log(`[WAIT] At frontier — seq ${state.sequence}, 404 #${state.consecutive404s}. Sleeping ${STALL_DELAY_MS / 1000}s.`);
      }
      if (state.consecutive404s >= 100) {
        console.warn(`[ADVANCE] Seq ${state.sequence} — permanent gap detected, advancing.`);
        state.sequence++;
        state.consecutive404s = 0;
      }
      nextDelay = STALL_DELAY_MS;
    } else if (status === 403) {
      console.error(`[403] Blocked by R2Z2. Check user-agent or visit zKillboard Discord.`);
      nextDelay = THROTTLE_DELAY_MS;
    } else {
      console.error(`[ERROR] Fetch failed for seq ${state.sequence}: ${status || err.message}`);
      nextDelay = ERROR_DELAY_MS;
    }
  }

  setTimeout(poll, nextDelay);
}

async function startPoller() {
  try {
    await prime();
    console.log(`[BOOT] Poller active — starting at sequence ${state.sequence}`);
    poll();
  } catch (e) {
    const status = e.response?.status;
    const delay = status === 429 ? THROTTLE_DELAY_MS : 10000;
    console.error(`[PRIME] Failed — ${status || e.message}. Retrying in ${delay / 1000}s.`);
    setTimeout(startPoller, delay);
  }
}


async function shutdown(signal) {
  console.log(`[SHUTDOWN] ${signal} received — flushing state before exit...`);
  try {
    await hashCache.flush();
    statsManager.save();
    await reactionsManager.save(); 
    console.log("[SHUTDOWN] Flush complete. Exiting.");
  } catch (err) {
    console.error(`[SHUTDOWN] Flush error: ${err.message}`);
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));


(async () => {
  console.log("Initializing Socket.Kill...");
  await esi.loadCache(path.join(__dirname, "data", "esi_cache.json"));
  await statsManager.recoverFromR2();
  setInterval(() => statsManager.save(), 60_000);
  await loadMarketPrices();
  await esi.loadSystemCache();
  setInterval(syncMarketPrices, 60_000);
  await reactionsManager.recoverFromR2();
  setInterval(() => reactionsManager.save(), reactionsManager.SAVE_INTERVAL_MS);
  processor = ProcessorFactory(esi, io, statsManager);
  await hashCache.prime();
  setInterval(() => hashCache.rotateIfNeeded(), 60_000);
  await esi.loadShipCache(); 
  refreshNebulaBackground();
  syncPlayerCount();
  setInterval(refreshNebulaBackground, NEBULA_ROTATION_MS);
  startPoller();
})();
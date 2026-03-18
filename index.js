require("dotenv").config({ quiet: true });
const talker = require("./src/network/agent");
const path = require("path");
const ESIClient = require("./src/network/esi");
const startWebServer = require("./src/services/webServer");
const normalizer = require("./src/core/normalizer");
const utils = require("./src/core/helpers");
const statsManager = require("./src/services/statsManager");
// const ProcessorFactory = require("./src/core/processor");
const ProcessorFactory = require("./src/core/processor_v2");
const esi = new ESIClient("Contact: @ScottishDex");
const { syncWars, loadWars, pollWarKillmails} = require('./src/services/warModule');


const ROTATION_SPEED = 10 * 60 * 1000;
const R2_BASE_URL = process.env.R2_BASE_URL
const SEQUENCE_CACHE_URL = `${R2_BASE_URL}/sequence.json`;

const sharedState = {
    isThrottled: false,
    currentSequence: 0
};

const { io } = startWebServer(esi, statsManager, sharedState);

let currentSequence = 0;
let consecutive404s = 0;
let lastSuccessfulIngest = Date.now();
let lastErrorStatus = null;
let isThrottled = false;

const startMonitor = require("./src/network/monitor"); 
startMonitor(750);

let currentSpaceBg = null;
let processor = null;

async function syncPlayerCount() {
  const status = await utils.getPlayerCount();
  if (status) {
    io.emit("player-count", status);
  }
}

io.on("connection", async (socket) => {
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const userAgent = socket.handshake.headers['user-agent'] || 'Unknown';
    const referrer = socket.handshake.headers['referer'] || 'Direct';
    console.log(`[NETWORK] New connection: ${socket.id} | IP: ${ip} | UA: ${userAgent} | Ref: ${referrer} | Total Active: ${io.engine.clientsCount}`)
    
  if (currentSpaceBg) {
    socket.emit("nebula-update", currentSpaceBg);
  } else {
    refreshNebulaBackground();
  }
  const regions = Array.from(esi.cache.regions.values()).sort();
  socket.emit("region-list", regions);
  socket.emit("gatekeeper-stats", { totalScanned: statsManager.getTotal(),
    totalIsk:statsManager.totalIsk
   });
  const currentStatus = await utils.getPlayerCount();
  socket.emit("player-count", currentStatus);
});

async function refreshNebulaBackground() {
  console.log("Fetching Background Image");
  const data = await utils.getBackPhoto();
  if (data) {
    currentSpaceBg = data;
    io.emit("nebula-update", data);
    console.log(`Background Synced: ${data.name}`);
  }
}

// --- Configuration ---
const POLLING_CONFIG = {
    CATCHUP_SPEED: 75,    
    STALL_DELAY: 1000,    
    ERROR_BACKOFF: 5000,  
    PANIC_DELAY: 600000  
};

const processedKills = new Set();

async function r2BackgroundWorker() {
    // 1. Priming Phase
    
    try {
        const res = await talker.get(SEQUENCE_CACHE_URL, { timeout: 5000 });
        if (res.data?.sequence) {
            sharedState.currentSequence = parseInt(res.data.sequence) - 5;
        } else {
            throw new Error("Invalid sequence data");
        }
    } catch (e) {
        const status = e.response?.status;
        lastErrorStatus = status;
        const wait = status === 429 ? POLLING_CONFIG.PANIC_DELAY : 10000;
        console.error(`Priming failed:`, e.response?.status, e.response?.data, e.message);
        return setTimeout(r2BackgroundWorker, wait);
    }

    // 2. The Centralized Recursive Tick

    let lastKnownSequence = sharedState.currentSequence;
    

    const MAX_AGE = 24 * 60 * 60 * 1000;

    const poll = async () => {
      if (isThrottled) return;

  
      const isNewSequence = sharedState.currentSequence > lastKnownSequence
      const url = `${R2_BASE_URL}/${sharedState.currentSequence}.json${isNewSequence ? `?cb=${Date.now()}` : ''}`;
      let nextTick = 0;

      try {
        const response = await talker.get(url, { timeout: 2000 });
        const r2Package = normalizer.fromR2(response.data);

        if (r2Package?.killID) {

          const killTime = new Date(r2Package.esiData?.killmail_time).getTime();
          const currentTime = new Date().getTime();

          if (currentTime - killTime > MAX_AGE) {
            console.warn(`[OLD_MAIL] Discarding old killmail ${r2Package.killID} with timestamp ${killTime}`);
          } else if (!processedKills.has(r2Package.killID)) {
            processedKills.add(r2Package.killID);
            processor.processPackage(r2Package);
            if (processedKills.size > 1000) processedKills.clear();
            const killTime = new Date(r2Package.esiData?.killmail_time).getTime();
            const ingestDelay = Date.now() - killTime;
            console.log(`[INGEST] Kill ${r2Package.killID} | Age: ${(ingestDelay / 1000).toFixed(1)}s`);
          }

                lastKnownSequence = sharedState.currentSequence;
                sharedState.currentSequence++;
                consecutive404s = 0;
                lastSuccessfulIngest = Date.now();
              lastErrorStatus = 200;
              isThrottled = false;
              if (r2Package?.sequenceUpdated) {
                try {
                  const updatedRes = await talker.get(`${R2_BASE_URL}/${r2Package.sequenceUpdated}.json`, { timeout: 2000 });
                  const updatedPackage = normalizer.fromR2(updatedRes.data);
                  if (updatedPackage?.killID && !processedKills.has(updatedPackage.killID)) {
                    processedKills.add(updatedPackage.killID);
                    processor.processPackage(updatedPackage);
                    console.log(`Reprocessed updated sequence ${r2Package.sequenceUpdated}`);
                  }
                } catch (e) {
                  console.error(`Failed to refetch updated sequence ${r2Package.sequenceUpdated}:`, e);
                }
              }

            } else {
                // DATA GAP: File exists but normalize failed or no kill data
                consecutive404s++;
                if (consecutive404s === 1) console.log(`[GAP] Potential ghost file at ${currentSequence}. Retrying...`);
                nextTick = POLLING_CONFIG.STALL_DELAY;
                
                if (consecutive404s >= 5) {
                    console.warn(`[SKIP] Seq ${currentSequence} is ghost data. Skipping to next.`);
                    sharedState.currentSequence++;
                    consecutive404s = 0;
                }
            }
        } catch (err) {
            const status = err.response?.status;
            lastErrorStatus = status;

        if (status === 429) {
          sharedState.isThrottled = true;
          console.error("[429] Rate Limited. Entering 2m quiet period.");
          setTimeout(() => { isThrottled = false; poll(); }, POLLING_CONFIG.PANIC_DELAY);
          return; // Break recursion until timeout finishes
        }

        // AFTER
        if (status === 404) {
          try {
            const liveRes = await talker.get(SEQUENCE_CACHE_URL, { timeout: 5000 });
            const liveSeq = liveRes.data?.sequence;
            console.log(`[GAP] Current: ${sharedState.currentSequence} | Live: ${liveSeq} | Behind: ${liveSeq - sharedState.currentSequence} sequences`);
          } catch (_) { }
          sharedState.currentSequence = lastKnownSequence;
          nextTick = 6000;
        } else {
          nextTick = POLLING_CONFIG.ERROR_BACKOFF;
        }

        if (status === 404 && consecutive404s >= 30) {
          console.warn("[RE-SYNC] 404 limit reached. Re-priming...");
          return r2BackgroundWorker();
        }
      }

      setTimeout(poll, nextTick);
    };

    poll();
}

(async () => {
  console.log("Initializing Socket.Kill...");
  await esi.loadSystemCache("./data/systems.json");
  await esi.loadCache(path.join(__dirname, "data", "esi_cache.json"));
  await statsManager.recoverFromR2();
  refreshNebulaBackground();
  processor = ProcessorFactory(esi, io, statsManager);
  syncPlayerCount();
  await loadWars();
  syncWars();
  setInterval(syncWars, 60 * 60 * 1000);
  pollWarKillmails(processor.processPackage, processedKills); // ADD
  setInterval(() => pollWarKillmails(processor.processPackage, processedKills), 60 * 1000); // ADD
  setInterval(refreshNebulaBackground, ROTATION_SPEED);
  r2BackgroundWorker();
})();

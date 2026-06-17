const talker = require("./agent");
const fs = require('fs').promises;
const kvClient = require('../network/kvClient');

class ESIClient {
    constructor() {
        this.api = talker;
        this.baseURL = "https://esi.evetech.net";

        // Memory Cache
        this.cache = {
            characters: new Map(),
            corporations: new Map(),
            alliances: new Map()
        };

        // Static SDE Data from KV
        this.staticShipData = {};
        this.staticSystemData = {};
        this.staticRegionData = {};
        this.systemNameMap = new Map(); // O(1) lookups

        this.isDirty = false;
        this.isSaving = false;
        this.initialized = false;
    }

    /**
     * Call this at application startup before handling requests.
     */
    async initialize() {
        try {
            await Promise.all([
                this.loadShipCache(),
                this.loadSystemCache(),
                this.loadRegionCache(),
                this.loadPersistentCache('./data/esi_cache.json')
            ]);
            this.initialized = true;
            console.log("[ESIClient] Ready for production.");
        } catch (err) {
            console.error("[ESIClient] Critical Init Failure:", err);
            process.exit(1);
        }
    }

    // --- Data Accessors (Synchronous where possible) ---

    getTypeName(id) {
        return this.staticShipData[id]?.name ?? "Unknown";
    }

    getRegionName(id) {
        return this.staticRegionData[id]?.name ?? "Unknown";
    }

    getShipGroupID(typeID) {
        return this.staticShipData[typeID]?.groupID ?? null;
    }

    findSystemByName(name) {
        if (!name) return null;
        return this.systemNameMap.get(name.toLowerCase()) || null;
    }

    // --- Dynamic Fetching ---

    async getCharacterName(id) { return this.fetchAndCache(id, 'characters', '/characters'); }
    async getCorporationName(id) { return this.fetchAndCache(id, 'corporations', '/corporations'); }
    async getAllianceName(id) { return this.fetchAndCache(id, 'alliances', '/alliances'); }

    async fetchAndCache(id, category, endpoint) {
        if (!id || id === 0) return "Unknown";
        if (this.cache[category].has(id.toString())) return this.cache[category].get(id.toString());

        try {
            const { data } = await this.api.get(`${this.baseURL}${endpoint}/${id}/`);
            this.cache[category].set(id.toString(), data.name);
            this.isDirty = true;
            return data.name;
        } catch (err) {
            return "Unknown";
        }
    }

    // --- Persistence ---

    async saveCache(filePath) {
        if (this.isSaving) return;
        this.isSaving = true;
        try {
            const persistData = {
                characters: Object.fromEntries(this.cache.characters),
                corporations: Object.fromEntries(this.cache.corporations),
                alliances: Object.fromEntries(this.cache.alliances)
            };
            const json = JSON.stringify(persistData);
            await fs.writeFile(filePath, json);
            this.isDirty = false;
            // Async sync to R2 without blocking
            this.syncToR2('esi_cache.json', json).catch(console.error);
        } finally {
            this.isSaving = false;
        }
    }

    async loadPersistentCache(filePath) {
        try {
            const data = await fs.readFile(filePath, 'utf8');
            const json = JSON.parse(data);
            this.cache.characters = new Map(Object.entries(json.characters || {}));
            this.cache.corporations = new Map(Object.entries(json.corporations || {}));
            this.cache.alliances = new Map(Object.entries(json.alliances || {}));
        } catch (err) {
            console.warn("[ESI] No disk cache found, starting cold.");
        }
    }

    // --- KV Loaders ---

    async loadShipCache() {
        this.staticShipData = await kvClient.get('sde:ships') || {};
    }

    async loadSystemCache() {
        this.staticSystemData = await kvClient.get('sde:systems') || {};
        for (const [id, sys] of Object.entries(this.staticSystemData)) {
            this.systemNameMap.set(sys.name.toLowerCase(), sys);
        }
    }

    async loadRegionCache() {
        this.staticRegionData = await kvClient.get('sde:regions') || {};
    }

    async syncToR2(key, data) {
        const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/r2/buckets/${process.env.CF_CACHE_BUCKET}/objects/${key}`;
        await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${process.env.CF_R2_TOKEN}`, 'Content-Type': 'application/json' },
            body: data
        });
    }
}

module.exports = new ESIClient();
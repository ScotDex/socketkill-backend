const talker = require("./agent");
const fs = require('fs').promises;
const kvClient = require('../network/kvClient');

class ESIClient {
    constructor() {
        this.api = talker;
        this.baseURL = "https://esi.evetech.net";

        this.cache = {
            characters: new Map(),
            corporations: new Map(),
            types: new Map(),
            systems: new Map(),
            regions: new Map(),
            alliances: new Map(),
            allianceInfo: new Map(),
            variations: new Map()
        };

        this.staticShipData = {};
        this.staticSystemData = {};
        this.staticRegionData = {};
        this.systemNameMap = new Map();

        this.isDirty = false;

        setInterval(() => {
            if (this.isDirty) {
                this.saveCache('./data/esi_cache.json');
            }
        }, 1 * 60 * 1000);
    }

    async fetchAndCache(id, cacheCategory, endpoint) {
        if (!id || id === 0) return "Unknown";

        // Safely handle string vs int keys
        const strId = id.toString();
        const internalCache = this.cache[cacheCategory];

        if (internalCache && internalCache.has(strId)) {
            return internalCache.get(strId);
        }

        try {
            const response = await this.api.get(`${this.baseURL}${endpoint}/${id}/`);
            const name = response.data.name;

            if (internalCache) internalCache.set(strId, name);
            this.isDirty = true;
            return name;
        } catch (error) {
            console.error(`[ESI Error] Category: ${cacheCategory}, ID: ${id} - ${error.message}`);
            return "Unknown";
        }
    }

    // --- Persistence & Syncing ---

    async saveCache(filePath) {
        try {
            const persistData = {
                characters: Object.fromEntries(this.cache.characters),
                corporations: Object.fromEntries(this.cache.corporations),
                types: Object.fromEntries(this.cache.types),
                regions: Object.fromEntries(this.cache.regions),
                alliances: Object.fromEntries(this.cache.alliances),
                allianceInfo: Object.fromEntries(this.cache.allianceInfo),
            };
            const json = JSON.stringify(persistData, null, 2);
            await fs.writeFile(filePath, json);
            this.isDirty = false;
            console.log("[ESI] Cache persisted to disk.");
            await this.syncToR2('esi_cache.json', json);
        } catch (err) {
            console.error("[ESI] Save failed:", err.message);
        }
    }

    async syncToR2(key, data) {
        try {
            const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/r2/buckets/${process.env.CF_CACHE_BUCKET}/objects/${key}`;
            await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${process.env.CF_R2_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: typeof data === 'string' ? data : JSON.stringify(data)
            });
            console.log(`[R2] ${key} synced.`);
        } catch (err) {
            console.error(`[R2] Failed to sync ${key}:`, err.message);
        }
    }

    async loadCache(filePath) {
        try {
            const data = await fs.readFile(filePath, 'utf8');
            if (!data || data.trim() === "") throw new Error("Empty cache file");

            const json = JSON.parse(data);
            this.cache.characters = new Map(Object.entries(json.characters || {}));
            this.cache.corporations = new Map(Object.entries(json.corporations || {}));
            this.cache.types = new Map(Object.entries(json.types || {}));
            this.cache.regions = new Map(Object.entries(json.regions || {}));
            this.cache.alliances = new Map(Object.entries(json.alliances || {}));
            this.cache.allianceInfo = new Map(Object.entries(json.allianceInfo || {}));

            console.log(`[ESI] Persistent cache loaded. Types: ${this.cache.types.size}`);
        } catch (err) {
            console.warn("[ESI] No valid cache file found, starting fresh.");
            this.isDirty = true;
        }
    }

    // --- Static KV Loaders ---

    async loadShipCache() {
        try {
            const ships = await kvClient.get('sde:ships');
            if (ships) {
                this.staticShipData = ships;
                console.log(`[ESI] Loaded ${Object.keys(ships).length} ship type mappings`);
            }
        } catch (err) {
            console.error(`[ESI] Ship cache load failed: ${err.message}`);
        }
    }

    async loadSystemCache() {
        try {
            this.staticSystemData = await kvClient.get('sde:systems');
            if (!this.staticSystemData) throw new Error('sde:systems missing');

            this.systemNameMap = new Map();
            for (const [id, sys] of Object.entries(this.staticSystemData)) {
                this.systemNameMap.set(sys.name.toLowerCase(), sys);
            }
            return true;
        } catch (err) {
            console.error("[ESI] Failed to load systems:", err.message);
            return false;
        }
    }

    async loadRegionCache() {
        try {
            this.staticRegionData = await kvClient.get('sde:regions');
            if (!this.staticRegionData) throw new Error('sde:regions missing');
            console.log(`[ESI] Loaded ${Object.keys(this.staticRegionData).length} regions`);
            return true;
        } catch (err) {
            console.error('[ESI] Failed to load regions:', err.message);
            return false;
        }
    }

    // --- Core Entity Resolvers ---

    async getTypeName(id) {
        if (!id) return "Unknown";

        // 1. Try static KV data first (Handles Ships)
        if (this.staticShipData && this.staticShipData[id]) {
            return this.staticShipData[id].name;
        }

        // 2. Fallback to Memory Cache & ESI (Handles Modules, Drones, Ammo)
        return await this.fetchAndCache(id, 'types', '/universe/types');
    }

    async getTypeVariations(id) {
        if (!id) return [];
        const strId = id.toString();
        if (this.cache.variations.has(strId)) {
            return this.cache.variations.get(strId);
        }
        try {
            const res = await this.api.get(`https://images.evetech.net/types/${id}/`);
            const list = Array.isArray(res.data) ? res.data : [];
            this.cache.variations.set(strId, list);
            return list;
        } catch (err) {
            // Negative-cache the failure, or a broken type re-probes every render.
            this.cache.variations.set(strId, []);
            return [];
        }
    }

    async getRegionName(id) {
        if (!id) return "Unknown";

        // 1. Try static KV data first
        if (this.staticRegionData && this.staticRegionData[id]) {
            return this.staticRegionData[id].name;
        }

        // 2. Fallback to Memory Cache & ESI
        return await this.fetchAndCache(id, 'regions', '/universe/regions');
    }

    getShipGroupID(typeID) {
        return this.staticShipData?.[typeID]?.groupID ?? null;
    }

    async getCharacterName(id) {
        return this.fetchAndCache(id, 'characters', '/characters');
    }

    async getCorporationName(id) {
        return this.fetchAndCache(id, 'corporations', '/corporations');
    }

    async getAllianceName(id) {
        return this.fetchAndCache(id, 'alliances', '/alliances');
    }

    async getAllianceInfo(id) {
    if (!id || id === 0) return null;
    const strId = id.toString();

    if (this.cache.allianceInfo.has(strId)) {
        return this.cache.allianceInfo.get(strId);
    }

    try {
        const response = await this.api.get(`${this.baseURL}/alliances/${id}/`);
        const info = { name: response.data.name, ticker: response.data.ticker };
        this.cache.allianceInfo.set(strId, info);
        this.isDirty = true;
        return info;
    } catch (error) {
        console.error(`[ESI Error] allianceInfo ID: ${id} - ${error.message}`);
        return null;
    }
}

    // --- Utility & Search ---

    async getCharacterID(name) {
        try {
            const { data } = await this.api.post(`${this.baseURL}/universe/ids/`, [name]);
            return data.characters?.[0]?.id || null;
        } catch (error) {
            return null;
        }
    }

    findSystemByName(name) {
        if (!name) return null;
        return this.systemNameMap.get(name.toLowerCase()) || null;
    }

    getSystemDetails(id) {
        const raw = this.staticSystemData?.[id];
        if (!raw) return null;
        return {
            name: raw.name,
            region_id: raw.regionID,
            security_status: raw.security,
        };
    }

    async getRoute(originId, destinationId) {
        try {
            const { data } = await this.api.get(`${this.baseURL}/route/${originId}/${destinationId}/`);
            return data;
        } catch (error) {
            return null;
        }
    }
}

module.exports = new ESIClient();

const talker = require("./agent");
const fs = require(`fs`).promises;


class ESIClient {
    constructor() {
        this.api = talker;
        this.baseURL = "https://esi.evetech.net/latest";

        this.cache = {
            characters: new Map(),
            corporations: new Map(),
            types: new Map(),
            systems: new Map(),
            regions: new Map(),
            alliances: new Map()
        };

        this.staticSystemData = {};
        this.isDirty = false;

        setInterval(() => {
            if (this.isDirty) {
                this.saveCache('./data/esi_cache.json');
            }
        }, 1 * 60 * 1000);
    }
    async fetchAndCache(id, cacheCategory, endpoint) {
        if (!id || id === 0) return "Unknown";

        const internalCache = this.cache[cacheCategory];
        if (internalCache && internalCache.has(id)) {
            return internalCache.get(id);
        }

        try {
            const response = await this.api.get(`${this.baseURL}${endpoint}/${id}/`);
            const name = response.data.name;

            if (internalCache) internalCache.set(id, name);
            this.isDirty = true;
            return name;
        } catch (error) {
            console.error(`[ESI Error] Category: ${cacheCategory}, ID: ${id} - ${error.message}`);
            return "Unknown";
        }
    }

    async saveCache(filePath) {
        try {
            const persistData = {
                characters: Object.fromEntries(this.cache.characters),
                corporations: Object.fromEntries(this.cache.corporations),
                types: Object.fromEntries(this.cache.types),
                regions: Object.fromEntries(this.cache.regions),
                alliances: Object.fromEntries(this.cache.alliances)
            };
            const json = JSON.stringify(persistData, null, 2);
            await fs.writeFile(filePath, json);
            this.isDirty = false; // Reset flag after successful save
            console.log("Cache persisted to disk.");
            await this.syncToR2('esi_cache.json', json);
        } catch (err) {
            console.error("Save failed:", err.message);
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
            if (!data || data.trim() === "") {
                console.warn("Cache file is empty. Initializing default structure...");
                this.isDirty = true; // Force a save later
                return;
            }
            const json = JSON.parse(data);
            this.cache.characters = new Map(Object.entries(json.characters || {}));
            this.cache.corporations = new Map(Object.entries(json.corporations || {}));
            this.cache.types = new Map(Object.entries(json.types || {}));
            this.cache.regions = new Map(Object.entries(json.regions || {}));
            this.cache.alliances = new Map(Object.entries(json.alliances || {}));
            console.log(`Persistent cache loaded. Regions cached: ${this.cache.regions.size}`);
            console.log(`Characters cached: ${this.cache.characters.size}`);
            console.log(`Corporations cached: ${this.cache.corporations.size}`);
            console.log(`Types cached: ${this.cache.types.size}`);
            console.log(`Alliances cached: ${this.cache.alliances.size}`);
        } catch (err) {
            console.warn("No cache file found, starting fresh.");
        }
    }

    async getCharacterID(name) {
        try {
            const { data } = await this.api.post(`${this.baseURL}/universe/ids/`, [name]);
            return data.characters?.[0]?.id || null;
        } catch (error) {
            console.error(`Could not resolve ID for ${name}`);
            return null;
        }
    }

    async getCharacterName(id) {
        return this.fetchAndCache(id, 'characters', '/characters');
    }

    async getCorporationName(id) {
        return this.fetchAndCache(id, 'corporations', '/corporations');
    }

    async getTypeName(id) {
        return this.fetchAndCache(id, 'types', '/universe/types');
    }

    async getAllianceName(id) {
        return this.fetchAndCache(id, 'alliances', '/alliances');
    }



    // async loadSystemCache(filePath) {
    //     try {
    //         const data = await fs.readFile(filePath, 'utf8');
    //         this.staticSystemData = JSON.parse(data);
    //         this.systemNameMap = new Map();
    //         for (const [id, sys] of Object.entries(this.staticSystemData)) {
    //             this.systemNameMap.set(sys.name.toLowerCase(), sys);
    //         }
    //         return true;
    //     } catch (err) {
    //         console.error("Failed to load static system data:", err.message);
    //         return false;
    //     }
    // }

    async loadSystemCache() {
        try {
            const kv = require ('./kvClient');
            this.staticSystemData = await kv.get('systems:all');
            if (!this.staticSystemData){
                throw new Error ('systems:all missing from KV');
            }

            this.systemNameMap = new Map();
            for (const [id, sys] of Object.entries(this.staticSystemData)) {
                this.systemNameMap.set(sys.name.toLowerCase(), sys);
            }
            return true;
        } catch (err) {
            console.error ("Failed to load static system data:", err.message);
            return false;
        }
    }

    findSystemByName(name) {
        if (!name) return null;
        const query = name.toLowerCase();
        return Object.values(this.staticSystemData).find(sys =>
            sys.name.toLowerCase().startsWith(query)
        ) || null;
    }

    async getRoute(originId, destinationId) {
        try {
            const { data } = await this.api.get(`${this.baseURL}/route/${originId}/${destinationId}/`);
            return data;
        } catch (error) {
            return null;
        }
    }

    getSystemDetails(id) {
        const result = this.staticSystemData[id] || null;
        if (!result) {
            console.warn(`[SYS MISS] Unknown system ID: ${id}`);
        }
        return result;
    }

    async getRegionName(id) {
        return await this.fetchAndCache(id, 'regions', '/universe/regions');
    }



}
module.exports = new ESIClient();

const utils = require("../core/helpers");
const r2 = require('../network/r2Writer');

class StatsManager {
    constructor() {
        this.sessionScanned = 0;
        this.sessionIsk = 0;
        this.startTime = new Date();
    }
    increment(iskValue = 0) {
        const val = Number(iskValue) || 0;
        this.totalScanned++;
        this.sessionScanned++;
        this.totalIsk += val;
        this.sessionIsk += val;
        return {
            total: this.totalScanned,
            isk: this.totalIsk
        };
    }
    getTotal() {
        return this.totalScanned;
    }
    getStatsForReport() {
        return {
            startTime: this.startTime,
            scanCount: this.sessionScanned, 
        };
    }
    resetSession() {
        this.sessionScanned = 0;
    }
    save() {
        r2.put('stats.json', {
            totalKills: this.totalScanned,
            lastUpdate: new Date().toISOString()
    });

     r2.put('financials.json', {
            totalIsk: this.totalIsk,
            lastUpdate: new Date().toISOString()
    });
}

async recoverFromR2() {
    const stats = await r2.get('stats.json');
    if (stats) {
        this.totalScanned = stats.totalKills ?? this.totalScanned;
        console.log(`[STATS] Loaded ${this.totalScanned} kills from R2`);
    } else {
        console.log(`[STATS] R2 unavailable, using disk: ${this.totalScanned} kills`);
    }

    const financials = await r2.get('financials.json');
    if (financials) {
        this.totalIsk = financials.totalIsk ?? this.totalIsk;
        console.log(`[STATS] Loaded ISK from R2`);
    } else {
        console.log(`[STATS] R2 unavailable, using disk ISK`);
    }
    }
}

module.exports = new StatsManager();
const utils = require("../core/helpers");
const r2 = require('../network/r2Writer');

class StatsManager {
    constructor() {
        this.totalScanned = utils.loadPersistentStats() || 0;
        this.totalIsk = utils.loadPersistentIsk() || 0;
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
        utils.savePersistentStats(this.totalScanned);
        utils.savePersistentIsk(this.totalIsk);
        r2.put('stats.json', {
            totalKills: this.totalScanned,
            lastUpdate: new Date().toISOString()
    });

     r2.put('financials.json', {
            totalIsk: this.totalIsk,
            lastUpdate: new Date().toISOString()
    });
}
}
module.exports = new StatsManager();
// monitor.js
const v8 = require('v8');

function startMonitor(thresholdMB = 750) {
    console.log(`[SYSTEM] Vital Signs Monitor Active (Threshold: ${thresholdMB}MB)`);

    let tick = 0;

    setInterval(() => {
        const mem = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();
        const toMB = (bytes) => Math.round(bytes / 1024 / 1024);

        const rss = toMB(mem.rss);
        const heapUsed = toMB(mem.heapUsed);
        const heapLimit = toMB(heapStats.heap_size_limit);
        const heapPct = heapUsed / heapLimit;

        tick++;
        const line = `RSS: ${rss}MB | Heap: ${heapUsed}/${heapLimit}MB`;

        if (rss > thresholdMB || heapPct > 0.85) {
            console.warn(`[SYSTEM] ALERT high memory — ${line}`);
        } else if (tick % 30 === 0) {
            console.log(`[SYSTEM] ${line}`);
        }
    }, 10000);
}

module.exports = startMonitor;
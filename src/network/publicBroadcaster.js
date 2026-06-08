require("dotenv").config();
const talker = require("./agent");

const DO_ENDPOINT = process.env.PUBLIC_STREAM_ENDPOINT;
const DO_SECRET = process.env.PUBLIC_STREAM_SECRET;
const TIMEOUT_MS = 2000;
const LOG_EVERY_N_FAILURES = 100;

const metrics = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    lastError: null,
    lastErrorAt: null,
    lastSuccessAt: null,
}

async function publish(payload) {
    if (!DO_ENDPOINT || !DO_SECRET) console.warn("[PUBLIC BROADCAST] disabled — endpoint/secret not set");
    metrics.attempted++;

    try {
        await talker.post(DO_ENDPOINT, payload, {
            timeout: TIMEOUT_MS,
            headers: {
                "Content-Type": "application/json",
                "X-Backend-Auth": DO_SECRET,
            },
        });
        metrics.succeeded++;
        metrics.lastSuccessAt = new Date().toISOString();
    } catch (err) {
        metrics.failed++;
        metrics.lastError = err.message;
        metrics.lastErrorAt = new Date().toISOString();

        if (metrics.failed % LOG_EVERY_N_FAILURES === 1) {
            console.warn(`[PUBLIC BROADCAST] Failure #${metrics.failed}: ${err.message}`);
        }
    }
}

function getMetrics() {
    return { ...metrics };
}

module.exports = { publish, getMetrics };  
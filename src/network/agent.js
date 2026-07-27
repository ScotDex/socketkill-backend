const https = require('https');
const axios = require('axios');

const persistentAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 32,
    keepAliveMsecs: 1000,
    maxFreeSockets: 8,
    timeout: 60000,
    scheduling: 'lifo'
});

const talker = axios.create({
    httpsAgent: persistentAgent,
    timeout: 15000,
    headers: {
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'User-Agent': 'Socket.Kill - (@Discord 267750073910165504 / https://socketkill.com/)',
    }
});

setInterval(() => {
    const active = Object.values(persistentAgent.sockets).reduce((acc, arr) => acc + arr.length, 0);
    const queued = Object.values(persistentAgent.requests).reduce((acc, arr) => acc + arr.length, 0);
    if (active > 0 || queued > 0) {
        console.log(`[AGENT] Active Sockets: ${active}/32 | Queued Requests: ${queued}`);
    }
}, 2000);

module.exports = talker;
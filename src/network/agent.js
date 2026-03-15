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
        'User-Agent': 'Socket.Kill - (@ScottishDex/https://socketkill.com/)',
    }
});

module.exports = talker;
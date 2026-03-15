const http2adapter = require('axios-http2-adapter');
const axios = require ('axios');

const talker = axios.create({
    adapter: http2adapter,
    timeout: 15000,
    headers:  {
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Socket.Kill - (@ScottishDex/https://socketkill.com/)',
    }
});

module.exports = talker;
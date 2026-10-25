const axios = require('../network/agent');

let token = null;
let expiresAt = 0;
let pending = null;

async function fetchToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.KICK_CLIENT_ID,
    client_secret: process.env.KICK_CLIENT_SECRET,
  });
  const { data } = await axios.post('https://id.kick.com/oauth/token', body, { timeout: 5000 });
  token = data.access_token;
  expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  console.log(`[KICK AUTH] token ok, expires in ${data.expires_in}s`);
  return token;
}

async function getToken() {
  if (token && Date.now() < expiresAt) return token;
  if (!pending) pending = fetchToken().finally(() => { pending = null; });
  return pending;
}

module.exports = { getToken };

// force rebuild
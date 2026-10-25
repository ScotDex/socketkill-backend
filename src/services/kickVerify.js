const crypto = require('crypto');
const axios = require('../network/agent');

let publicKey = null;
const seen = new Map();
const TOLERANCE_MS = 5 * 60 * 1000;

async function loadKey() {
  const { data } = await axios.get('https://api.kick.com/public/v1/public-key', { timeout: 5000 });
  publicKey = crypto.createPublicKey(data.data.public_key);
  console.log('[KICK WH] public key loaded');
}

function verify(headers, rawBody) {
  if (!publicKey) return 'no-key';

  const id  = headers['kick-event-message-id'];
  const ts  = headers['kick-event-message-timestamp'];
  const sig = headers['kick-event-signature'];
  if (!id || !ts || !sig) return 'missing-headers';

  const age = Math.abs(Date.now() - Date.parse(ts));
  if (!(age <= TOLERANCE_MS)) return 'stale';

  if (seen.has(id)) return 'duplicate';

  const signed = Buffer.concat([Buffer.from(`${id}.${ts}.`), rawBody]);
  const ok = crypto.verify('sha256', signed, publicKey, Buffer.from(sig, 'base64'));
  if (!ok) return 'bad-signature';

  seen.set(id, Date.now() + TOLERANCE_MS);
  return 'ok';
}

setInterval(() => {
  const now = Date.now();
  for (const [id, expiry] of seen) if (expiry < now) seen.delete(id);
}, 60_000).unref();

module.exports = { loadKey, verify };
const axios = require('../network/agent');

const PLEX_REGION = 19000001;
const PLEX_TYPE = 44992;
const GBP_PER_PLEX = 0.04;

let plexRate = null;

async function refresh() {
  const res = await axios.get(
    `https://esi.evetech.net/markets/${PLEX_REGION}/history/?type_id=${PLEX_TYPE}`,
    { headers: { 'X-Compatibility-Date': '2025-12-16' } }
  );
  const history = res.data;
  if (!Array.isArray(history) || history.length === 0) throw new Error('empty PLEX history');

  const latest = history[history.length - 1];
  const iskPerPlex = latest.average;
  if (!iskPerPlex || iskPerPlex <= 0) throw new Error(`bad PLEX average: ${iskPerPlex}`);

  plexRate = {
    gbpPerIsk: GBP_PER_PLEX / iskPerPlex,
    iskPerPlex,
    updated: new Date().toISOString(),
  };
  console.log(`[PLEX] rate updated: 1 PLEX = ${Math.round(iskPerPlex).toLocaleString()} ISK`);
}

function get() {
  return plexRate;
}

module.exports = { refresh, get };
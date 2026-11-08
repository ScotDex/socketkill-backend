const MAX_PER_MIN = Number(process.env.ZKILL_FAILOVER_PER_MIN ?? 10);
const WINDOW_MS = 60_000;
const stamps = [];

function tryTake() {
  const now = Date.now();
  while (stamps.length && now - stamps[0] >= WINDOW_MS) {
    stamps.shift();
  }
  if (stamps.length >= MAX_PER_MIN) return false;
  stamps.push(now);
  return true;
}

module.exports = { tryTake };
const MAX_COLD = Number(process.env.COLD_GATE_MAX ?? 3);
let inFlight = 0;

function acquire(req, res) {
  if (inFlight >= MAX_COLD) {
    console.warn(`[COLD GATE] full ${inFlight}/${MAX_COLD} path=${req.path}`);
    res.set('Cache-Control', 'no-store');
    res.set('Retry-After', '5');
    res.status(503).json({ error: 'Archive busy — retry shortly.' });
    return null;
  }

  inFlight++;
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    inFlight--;
  };
}

module.exports = { acquire };
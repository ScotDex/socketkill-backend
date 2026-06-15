const IMMUTABLE = 'public, max-age=31536000, immutable';

function clientIp(req) {
  return req.get('CF-Connecting-IP')
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

function requestMeta(req) {
  return {
    ip: clientIp(req),
    ua: (req.get('User-Agent') || '').slice(0, 80),
    ref: (req.get('Referer') || 'Direct').slice(0, 60),
  };
}

function setCacheHeader(res, { isToday, todayMaxAge }) {
  res.set('Cache-Control', isToday ? `public, max-age=${todayMaxAge}` : IMMUTABLE);
}

module.exports = { clientIp, requestMeta, setCacheHeader, IMMUTABLE };
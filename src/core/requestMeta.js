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

module.exports = { clientIp, requestMeta };
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatTime(iso) {
    if (!iso) return 'Unknown';
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').replace(/\..+/, '') + ' UTC';
}

function renderKillPage({ killID, killmail, resolved }) {
    const {
        victimName, victimCorp, victimShip,
        systemName, regionName, security,
        finalBlowName, finalBlowCorp, finalBlowShip,
        attackers
    } = resolved;

    const time = formatTime(killmail.killmail_time);
    const attackerCount = attackers.length;

    // Open Graph metadata for Discord/Bluesky/Slack/Twitter previews
    const ogTitle = `${victimName} loses ${victimShip} in ${systemName}`;
    const ogDesc = `${attackerCount} attacker${attackerCount === 1 ? '' : 's'} | Final blow: ${finalBlowName} (${finalBlowShip}) | ${time}`;
    const ogImage = `https://images.evetech.net/types/${killmail.victim.ship_type_id}/render?size=512`;

    const attackerRows = attackers.map(a => `
        <tr>
            <td>${escapeHtml(a.name)}</td>
            <td>${escapeHtml(a.corp)}</td>
            <td>${escapeHtml(a.ship)}</td>
            <td style="text-align:right">${(a.damage || 0).toLocaleString()}</td>
        </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(ogTitle)} | Socket.Kill</title>

<meta name="description" content="Socket.Kill - Live kill feed for Eve Online optimized for rendering speed and performance complete with a global NPC death counter, system and region filter.">
<meta name="author" content="Dexomus Viliana">
<meta name="keywords" content="eve online, eve, pvp, socket.kill, killboard, real-time, intel, whale hunter, wormhole, low-latency, eve tool, pvp tracker, gatekeeper, mmorpg, third, party, tools, socket, kill, socket kill, socket kill feed">
<link rel="icon" type="image/png" href="https://edge.socketkill.com/favicon.png">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(ogTitle)}">
<meta property="og:description" content="${escapeHtml(ogDesc)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:url" content="https://socketkill.com/kill/${killmail.killmail_time.slice(0,10)}/${killID}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(ogTitle)}">
<meta name="twitter:description" content="${escapeHtml(ogDesc)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="stylesheet" href="/css/kill.css">
</head>
<body>
<h1>${escapeHtml(victimName)} &mdash; ${escapeHtml(victimShip)}</h1>
<div class="meta">Killmail #${killID} &middot; ${escapeHtml(time)}</div>

<div class="victim-block">
    <img src="${escapeHtml(ogImage)}" alt="${escapeHtml(victimShip)}">
    <div>
        <div><strong>${escapeHtml(victimName)}</strong></div>
        <div>${escapeHtml(victimCorp)}</div>
        <div>Lost a <strong>${escapeHtml(victimShip)}</strong></div>
    </div>
</div>

<h2>Location</h2>
<div>${escapeHtml(systemName)} (${security?.toFixed?.(1) ?? '?'}) &middot; ${escapeHtml(regionName)}</div>

<h2>Final Blow</h2>
<div>${escapeHtml(finalBlowName)} &middot; ${escapeHtml(finalBlowCorp)} &middot; ${escapeHtml(finalBlowShip)}</div>

<h2>Attackers (${attackerCount})</h2>
<table>
    <thead><tr><th>Pilot</th><th>Corporation</th><th>Ship</th><th style="text-align:right">Damage</th></tr></thead>
    <tbody>${attackerRows}</tbody>
</table>

<div class="footer">
    <a href="https://zkillboard.com/kill/${killID}/" rel="noopener">View on zKillboard</a> &middot;
    <a href="https://socketkill.com/">Socket.Kill</a>
</div>
</body>
</html>`;
}

module.exports = { renderKillPage };
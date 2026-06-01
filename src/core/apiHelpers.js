


function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function parseIDList(value) {
  if (!value) return [];
  return String(value).split(',').map(v => parseInt(v.trim(), 10)).filter(Number.isFinite);
}

function parseSpaceList(value) {
  if (!value) return [];
  const valid = new Set(['high', 'low', 'null', 'wh', 'pochven', 'unknown']);
  return String(value).split(',').map(v => v.trim().toLowerCase()).filter(v => valid.has(v));
}

function matchesFilters(entry, f) {
  if (f.shipTypeIDs.length && !f.shipTypeIDs.includes(entry.shipID)) return false;
  if (f.shipGroupIDs.length && !f.shipGroupIDs.includes(entry.shipGroupID)) return false;
  if (f.systemIDs.length && !f.systemIDs.includes(entry.systemID)) return false;
  if (f.regionIDs.length && !f.regionIDs.includes(entry.regionID)) return false;
  if (f.space.length && !f.space.includes(entry.space)) return false;
  if (f.minValue !== null && (entry.totalValue ?? 0) < f.minValue) return false;
  if (f.maxValue !== null && (entry.totalValue ?? 0) > f.maxValue) return false;
  if (f.minAttackers !== null && (entry.attackerCount ?? 0) < f.minAttackers) return false;
  if (f.maxAttackers !== null && (entry.attackerCount ?? 0) > f.maxAttackers) return false;
  if (f.solo && entry.attackerCount !== 1) return false;
  if (f.victimCorpIDs.length && !f.victimCorpIDs.includes(entry.victimCorpID)) return false;
  if (f.victimAllianceIDs.length && !f.victimAllianceIDs.includes(entry.victimAllianceID)) return false;
  if (f.attackerCorpIDs.length && !(entry.attackerCorpIDs ?? []).some(id => f.attackerCorpIDs.includes(id))) return false;
  if (f.attackerAllianceIDs.length && !(entry.attackerAllianceIDs ?? []).some(id => f.attackerAllianceIDs.includes(id))) return false;
  return true;
}

module.exports = {
  todayUTC,
  parseIDList,
  parseSpaceList,
  matchesFilters
};
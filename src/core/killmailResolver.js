const axios = require('../network/agent');
const helpers = require('./helpers');
const { resolveItems } = require('./itemResolver');
const { calculateKillValue, calculateBreakdown } = require('../services/priceService');

async function fetchZkbMeta(killID) {
  try {
    const res = await axios.get(`https://zkillboard.com/api/killID/${killID}/`, {
      timeout: 3000,
    });
    return res.data?.[0]?.zkb || null;
  } catch (err) {
    console.warn(`[ZKB FETCH] ${killID} failed: ${err.message}`);
    return null;
  }
}


async function resolveKillDetail(killmail, hash, id, esi) {
  const victim = killmail.victim;
  const finalBlow = killmail.attackers.find(a => a.final_blow) || killmail.attackers[0];
  const systemDetails = esi.getSystemDetails(killmail.solar_system_id);

  const [
    victimName, victimCorp, victimAlliance, victimShip,
    finalBlowName, finalBlowCorp, finalBlowShip,
    regionName, zkb, items,
    ...attackerData
  ] = await Promise.all([
    esi.getCharacterName(victim.character_id),
    esi.getCorporationName(victim.corporation_id),
    victim.alliance_id ? esi.getAllianceName(victim.alliance_id) : Promise.resolve(null),
    esi.getTypeName(victim.ship_type_id),
    esi.getCharacterName(finalBlow.character_id),
    esi.getCorporationName(finalBlow.corporation_id),
    esi.getTypeName(finalBlow.ship_type_id),
    systemDetails?.region_id ? esi.getRegionName(systemDetails.region_id) : Promise.resolve('K-Space'),
    fetchZkbMeta(id),
    resolveItems(victim.items, esi),
    ...killmail.attackers.flatMap(a => [
      esi.getCharacterName(a.character_id),
      esi.getCorporationName(a.corporation_id),
      esi.getTypeName(a.ship_type_id),
      a.alliance_id ? esi.getAllianceName(a.alliance_id) : Promise.resolve(null),
      a.weapon_type_id ? esi.getTypeName(a.weapon_type_id) : Promise.resolve(null),
    ])
  ]);

  const damageTaken = victim.damage_taken || 0;

  const attackers = killmail.attackers.map((a, i) => ({
    name: attackerData[i * 5],
    characterID: a.character_id || null,
    corp: attackerData[i * 5 + 1],
    corporationID: a.corporation_id || null,
    alliance: attackerData[i * 5 + 3],
    allianceID: a.alliance_id || null,
    ship: attackerData[i * 5 + 2],
    shipTypeID: a.ship_type_id || null,
    weapon: attackerData[i * 5 + 4],
    weaponTypeID: a.weapon_type_id || null,
    damage: a.damage_done,
    damagePercent: damageTaken > 0
      ? Math.round((a.damage_done / damageTaken) * 1000) / 10
      : 0,
    finalBlow: !!a.final_blow
  }));
  const value = calculateBreakdown(items, victim.ship_type_id);
  return {
    killID: id,
    killmailHash: hash,
    killmailTime: killmail.killmail_time,
    rawValue: value.totalValue,
    totalValue: value.totalValue ? helpers.formatIsk(value.totalValue) : null,
    droppedValue: value.droppedValue ? helpers.formatIsk(value.droppedValue) : null,
    destroyedValue: value.destroyedValue ? helpers.formatIsk(value.destroyedValue) : null,
    fittedValue: value.fittedValue ? helpers.formatIsk(value.fittedValue) : null,
    items,
    victim: {
      name: (victimName === "Unknown" || !victimName) ? victimCorp : victimName,
      characterID: victim.character_id,
      corp: victimCorp,
      corporationID: victim.corporation_id,
      alliance: victimAlliance,
      allianceID: victim.alliance_id || null,
      ship: victimShip,
      shipTypeID: victim.ship_type_id,
      damageTaken: victim.damage_taken
    },
    system: {
      id: killmail.solar_system_id,
      name: systemDetails?.name || 'Unknown System',
      region: regionName,
      regionID: systemDetails?.region_id,
      security: systemDetails?.security_status
    },
    finalBlow: {
      name: finalBlowName,
      characterID: finalBlow.character_id || null,
      corp: finalBlowCorp,
      corporationID: finalBlow.corporation_id || null,
      ship: finalBlowShip,
      shipTypeID: finalBlow.ship_type_id || null,
    },
    attackers,
    attackerCount: attackers.length
  };
}

async function resolveKillSummary(killmail, killID, esi) {
  const { calculateKillValue } = require('../services/priceService');

  const victim = killmail.victim;
  const sys = esi.getSystemDetails(killmail.solar_system_id);
  const finalBlow = killmail.attackers?.find(a => a.final_blow) || killmail.attackers?.[0];

  const [vName, vCorp, vAlliance, vShip, region, fbCorp] = await Promise.all([
    esi.getCharacterName(victim.character_id),
    esi.getCorporationName(victim.corporation_id),
    victim.alliance_id ? esi.getAllianceName(victim.alliance_id) : Promise.resolve(null),
    esi.getTypeName(victim.ship_type_id),
    sys?.region_id ? esi.getRegionName(sys.region_id) : Promise.resolve('K-Space'),
    finalBlow?.corporation_id ? esi.getCorporationName(finalBlow.corporation_id) : Promise.resolve('Unknown'),
  ]);

  const rawValue = calculateKillValue(killmail);

  return {
    killID: parseInt(killID),
    time: killmail.killmail_time,
    rawValue,
    formattedValue: helpers.formatIsk(rawValue),
    victim: {
      name: (vName === 'Unknown' || !vName) ? vCorp : vName,
      characterID: victim.character_id || null,
      corp: vCorp,
      corporationID: victim.corporation_id || null,
      alliance: vAlliance,
      allianceID: victim.alliance_id || null,
      ship: vShip,
      shipTypeID: victim.ship_type_id,
    },
    system: {
      id: killmail.solar_system_id,
      name: sys?.name || 'Unknown',
      region,
      regionID: sys?.region_id,
      security: sys?.security_status,
    },
    finalBlowCorp: fbCorp,
    attackerCount: killmail.attackers?.length || 0,
  };
}

module.exports = { resolveKillDetail, resolveKillSummary };
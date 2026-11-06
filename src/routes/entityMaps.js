const ENTITY_COLUMNS = {
  pilot: { victim: 'victim_character_id', attacker: 'character_id' },
  corp: { victim: 'victim_corp_id', attacker: 'corp_id' },
  alliance: { victim: 'victim_alliance_id', attacker: 'alliance_id' },
};

module.exports = { ENTITY_COLUMNS };
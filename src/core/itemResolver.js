const { getPrice } = require('../services/priceService');
const helpers = require('../core/helpers');

const SLOT_GROUPS = {
    // fitted
    high: [27, 28, 29, 30, 31, 32, 33, 34],
    mid: [19, 20, 21, 22, 23, 24, 25, 26],
    low: [11, 12, 13, 14, 15, 16, 17, 18],
    rig: [92, 93, 94, 95, 96, 97, 98, 99],           // 95-99: structure rigs
    subsystem: [125, 126, 127, 128, 129, 130, 131, 132],
    service: [164, 165, 166, 167, 168, 169, 170, 171], // Upwell structure services
    // bays
    drone: [87],
    fighter: [158, 159, 160, 161, 162, 163],          // 161-163: FighterTube2-4
    booster: [176],
    frigateBay: [179],
    corpseBay: [174],
    implant: [89],
    // holds
    cargo: [5],
    fuelBay: [133],
    structureFuel: [172],
    oreHold: [134],
    gasHold: [135],
    mineralHold: [136],
    salvageHold: [137],
    shipHold: [138, 139, 140, 141, 142],              // general + S/M/L/industrial ship holds
    ammoHold: [143],
    planetaryHold: [148, 149],                        // command center + PI commodities
    materialBay: [151],
    fleetHangar: [155],
    shipHangar: [90],
    mobileDepotHold: [183],
    moonMaterialBay: [186],
    iceHold: [181],
    asteroidHold: [182],
    expeditionHold: [188]
};

const FITTED_GROUPS = new Set(['high', 'mid', 'low', 'rig', 'subsystem', 'service']);

function groupForFlag(flag) {
    if (flag === 0) return 'cargo';
    for (const [group, flags] of Object.entries(SLOT_GROUPS)) {
        if (flags.includes(flag)) return group;
    }
    return 'other';
}

function flatten(items, out = []) {
    for (const item of items || []) {
        out.push(item);
    }
    return out;
}

function pickVariation(list, isCopy) {
    if (!list?.length) return 'icon';
    if (isCopy && list.includes('bpc')) return 'bpc';
    if (list.includes('icon')) return 'icon';
    if (list.includes('bp')) return 'bp';
    return list[0];
}

function buildSlots(flat, nameMap, variationMap) {
    const byKey = new Map();

    for (const item of flat) {
        const group = groupForFlag(item.flag);
        if (!FITTED_GROUPS.has(group)) continue;

        const key = `${item.flag}:${item.item_type_id}`;
        const dropped = item.quantity_dropped || 0;
        const destroyed = item.quantity_destroyed || 0;
        const existing = byKey.get(key);

        if (existing) {
            existing.dropped += dropped;
            existing.destroyed += destroyed;
            existing.quantity += dropped + destroyed;
        } else {
            byKey.set(key, {
                _group: group,
                _flag: item.flag,
                name: nameMap.get(item.item_type_id) || 'Unknown',
                typeID: item.item_type_id,
                dropped,
                destroyed,
                quantity: dropped + destroyed,
                iconVariation: pickVariation(variationMap.get(item.item_type_id), item.singleton === 2),
            });
        }
    }

    const grouped = {};
    for (const entry of byKey.values()) {
        const { _group, _flag, ...rest } = entry;
        if (!grouped[_group]) grouped[_group] = new Map();
        if (!grouped[_group].has(_flag)) grouped[_group].set(_flag, []);
        grouped[_group].get(_flag).push(rest);
    }

    const out = {};
    for (const [group, flagMap] of Object.entries(grouped)) {
        out[group] = [...flagMap.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([flag, items]) => ({ flag, items }));
    }
    return out;
}

async function resolveItems(rawItems, esi) {
    if (!rawItems?.length) return { status: 'none', groups: {}, slots: {} };

    const flat = flatten(rawItems);
    const uniqueIds = [...new Set(flat.map(i => i.item_type_id))];
    const [names, variations] = await Promise.all([
        Promise.all(uniqueIds.map(id => esi.getTypeName(id))),
        Promise.all(uniqueIds.map(id => esi.getTypeVariations(id))),
    ]);
    const nameMap = new Map(uniqueIds.map((id, i) => [id, names[i]]));
    const variationMap = new Map(uniqueIds.map((id, i) => [id, variations[i]]));
    const slots = buildSlots(flat, nameMap, variationMap);
    const merged = new Map();
    for (const item of flat) {
        const group = groupForFlag(item.flag);
        const isCopy = item.singleton === 2;
        const unitPrice = isCopy ? 0 : getPrice(item.item_type_id);
        const key = `${group}:${item.item_type_id}:${isCopy ? 'c' : 'o'}`;
        const existing = merged.get(key);
        const dropped = item.quantity_dropped || 0;
        const destroyed = item.quantity_destroyed || 0;

        if (existing) {
            existing.dropped += dropped;
            existing.destroyed += destroyed;
            existing.quantity += dropped + destroyed;
            existing.formattedValue = helpers.formatIsk(existing.value * existing.quantity);
        } else {
            merged.set(key, {
                name: nameMap.get(item.item_type_id) || 'Unknown',
                typeID: item.item_type_id,
                _group: group,
                dropped,
                destroyed,
                quantity: dropped + destroyed,
                value: unitPrice,
                iconVariation: pickVariation(variationMap.get(item.item_type_id), isCopy),
                formattedValue: helpers.formatIsk(unitPrice * (dropped + destroyed)),
            });
        }
    }
    const groups = {};
    for (const item of merged.values()) {
        const { _group, ...rest } = item;
        if (!groups[_group]) groups[_group] = [];
        groups[_group].push(rest);
    }
    for (const arr of Object.values(groups)) arr.sort((a, b) => a.name.localeCompare(b.name));

    return { status: 'resolved', groups, slots };
}

module.exports = { resolveItems, SLOT_GROUPS, groupForFlag };
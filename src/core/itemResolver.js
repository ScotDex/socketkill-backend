const { getPrice } = require('../services/priceService');
const helpers = require('../core/helpers');

const SLOT_GROUPS = {
    high: [27, 28, 29, 30, 31, 32, 33, 34],
    mid: [19, 20, 21, 22, 23, 24, 25, 26],
    low: [11, 12, 13, 14, 15, 16, 17, 18],
    rig: [92, 93, 94],
    subsystem: [125, 126, 127, 128, 129, 130, 131, 132],
    drone: [87],
    cargo: [5],
    fighter: [158, 159, 160],
};

function groupForFlag(flag) {
    for (const [group, flags] of Object.entries(SLOT_GROUPS)) {
        if (flags.includes(flag)) return group;
    }
    return 'other';
}

function flatten(items, out = []) {
    for (const item of items || []) {
        out.push(item);
        if (item.items?.length) flatten(item.items, out);
    }
    return out;
}

async function resolveItems(rawItems, esi) {
    if (!rawItems?.length) return { status: 'none', groups: {} };

    const flat = flatten(rawItems);

    // Dedupe type IDs for efficient ESI resolution
    const uniqueIds = [...new Set(flat.map(i => i.item_type_id))];
    const names = await Promise.all(uniqueIds.map(id => esi.getTypeName(id)));
    const nameMap = new Map(uniqueIds.map((id, i) => [id, names[i]]));

    // Merge by group + typeID
    const merged = new Map();
    for (const item of flat) {
        const group = groupForFlag(item.flag);
        const key = `${group}:${item.item_type_id}`;
        const existing = merged.get(key);
        const dropped = item.quantity_dropped || 0;
        const destroyed = item.quantity_destroyed || 0;

        if (existing) {
            existing.dropped += dropped;
            existing.destroyed += destroyed;
            existing.quantity += dropped + destroyed;
        } else {
            merged.set(key, {
                name: nameMap.get(item.item_type_id) || 'Unknown',
                typeID: item.item_type_id,
                _group: group,
                dropped,
                destroyed,
                quantity: dropped + destroyed,
                value: getPrice(item.item_type_id),
                formattedValue: helpers.formatIsk(getPrice(item.item_type_id) * (dropped + destroyed)),
            });
        }
    }

    // Group and sort
    const groups = {};
    for (const item of merged.values()) {
        const { _group, ...rest } = item;
        if (!groups[_group]) groups[_group] = [];
        groups[_group].push(rest);
    }
    for (const arr of Object.values(groups)) arr.sort((a, b) => a.name.localeCompare(b.name));

    return { status: 'resolved', groups };
}

module.exports = { resolveItems, SLOT_GROUPS, groupForFlag };
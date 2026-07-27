const axios = require('../network/agent');
const r2 = require('../network/r2Writer');
const janiceOverlay = require('./janiceOverlay');

const ESI_BASE = 'https://esi.evetech.net';

let priceMap = new Map();

const MANUAL_PRICES = {
    670: 10000,
    33328: 10000,
};

function buildPriceMap(rawData) {
    return new Map(rawData.map(item => [item.type_id, {
        average_price: item.average_price,
        adjusted_price: item.adjusted_price,
    }]));
}


async function syncMarketPrices() {
    try {
        const res = await axios.get(`${ESI_BASE}/markets/prices`, {
            headers: { 'X-Compatibility-Date': '2025-12-16' }
        });
        const newMap = buildPriceMap(res.data);
        await r2.put('market_prices.json', res.data);
        priceMap = newMap;
        console.log(`[MARKET] Synced ${priceMap.size} prices`);
    } catch (err) {
        console.error(`[MARKET] Sync failed: ${err.message}`);
    }
}

async function loadMarketPrices() {
    try {
        const data = await r2.get('market_prices.json');
        if (!data) {
            await syncMarketPrices();
            return;
        }
        try {
            priceMap = buildPriceMap(data);
            console.log(`[MARKET] Loaded ${priceMap.size} prices from R2`);
        } catch (parseErr) {
            console.warn(`[MARKET] R2 data unusable, fetching live: ${parseErr.message}`);
            await syncMarketPrices();
        }
    } catch (err) {
        console.error(`[MARKET] Load failed: ${err.message}`);
    }
}

let syncTimer = null;

function startMarketSync(intervalMs = 6 * 60 * 60 * 1000) {
    if (syncTimer) return;
    syncTimer = setInterval(syncMarketPrices, intervalMs);
    if (syncTimer.unref) syncTimer.unref();
    console.log(`[MARKET] Sync scheduled every ${intervalMs / 3_600_000}h`);
}

function getPrice(typeId) {
    if (MANUAL_PRICES[typeId] != null) return MANUAL_PRICES[typeId];
    const janice = janiceOverlay.getJanicePrice(typeId);
    if (janice != null) return janice;
    const entry = priceMap.get(typeId);
    if (!entry) return 0;
    return entry.average_price ?? entry.adjusted_price ?? 0;
}

function calculateKillValue(esiData) {
    if (!esiData) return 0;

    if (priceMap.size === 0) {
        console.warn('[MARKET] calculateKillValue called with empty priceMap — returning 0');
    }

    const shipValue = getPrice(esiData.victim?.ship_type_id);

    const itemValue = (esiData.victim?.items || []).reduce((total, item) => {
        const price = item.singleton === 2 ? 0 : getPrice(item.item_type_id);
        const dropped = (item.quantity_dropped || 0) * price;
        const destroyed = (item.quantity_destroyed || 0) * price;
        return total + dropped + destroyed;
    }, 0);

    return shipValue + itemValue;
}

const FITTED_GROUPS = ['high', 'mid', 'low', 'rig', 'subsystem', 'drone', 'fighter'];

function calculateBreakdown(resolvedItems, shipTypeId) {
    const hull = getPrice(shipTypeId) || 0;

    let dropped = 0;
    let destroyed = 0;
    let fitted = 0;

    const groups = resolvedItems?.groups || {};
    for (const [groupName, list] of Object.entries(groups)) {
        const isFitted = FITTED_GROUPS.includes(groupName);
        for (const it of list) {
            const unit = it.value || 0;
            dropped += unit * (it.dropped || 0);
            destroyed += unit * (it.destroyed || 0);
            if (isFitted) fitted += unit * (it.quantity || 0);
        }
    }

    destroyed += hull;

    return {
        droppedValue: dropped,
        destroyedValue: destroyed,
        fittedValue: fitted,
        totalValue: dropped + destroyed,
    };
}

function getPricedTypeIDs() {
    return Array.from(priceMap.keys());
}

module.exports = { syncMarketPrices, loadMarketPrices, getPrice, calculateKillValue, calculateBreakdown, startMarketSync, getPricedTypeIDs };
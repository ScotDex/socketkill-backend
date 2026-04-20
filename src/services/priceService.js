const axios = require('../network/agent');
const r2 = require('../network/r2Writer');

const ESI_BASE = 'https://esi.evetech.net/latest';

let priceMap = new Map();

function buildPriceMap(rawData) {
    return new Map(rawData.map(item =>[item.type_id, {
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

function getPrice(typeId) {
    return priceMap.get(typeId)?.adjusted_price
        || priceMap.get(typeId)?.average_price
        || 0;
}

function calculateKillValue(esiData) {
    if (!esiData) return 0;

    if (priceMap.size === 0) {
        console.warn('[MARKET] calculateKillValue called with empty priceMap — returning 0');
    }

    const shipValue = getPrice(esiData.victim?.ship_type_id);

    const itemValue = (esiData.victim?.items || []).reduce((total, item) => {
        const price = getPrice(item.item_type_id);
        const dropped = (item.quantity_dropped || 0) * price;
        const destroyed = (item.quantity_destroyed || 0) * price * 0.5;
        return total + dropped + destroyed;
    }, 0);

    return shipValue + itemValue;
}

module.exports = { syncMarketPrices, loadMarketPrices, getPrice, calculateKillValue };
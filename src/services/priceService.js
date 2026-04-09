
async function syncMarketPrices() {
    try {
        const res = await talker.get(`${ESI_BASE}/markets/prices`, {
            headers: { 'X-Compatibility-Date': '2025-12-16' }
        });
        await r2.put('market_prices.json', res.data);
        priceMap = new Map(res.data.map(item => [item.type_id, {
            adjusted_price: item.adjusted_price,
            average_price: item.average_price
        }]));
        console.log(`[MARKET] Synced ${priceMap.size} prices`);
    } catch (err) {
        console.error(`[MARKET] Sync failed: ${err.message}`);
    }
}

async function loadMarketPrices() {
    try {
        const data = await r2.get('market_prices.json');
        if (data) {
            priceMap = new Map(data.map(item => [item.type_id, { adjusted_price: item.adjusted_price, average_price: item.average_price }]));
            console.log(`[MARKET] Loaded ${priceMap.size} prices from R2`);
        } else {
            // Nothing in R2 yet, fetch live
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

    const shipValue = getPrice(esiData.victim?.ship_type_id);

    const itemValue = (esiData.victim?.items || []).reduce((total, item) => {
        const price = getPrice(item.item.type_id);
        const dropped = (item.quantity_dropped || 0) * price;
        const destroyed = (item.quantity_destroyed || 0) * price * 0.5;
        return total + dropped + destroyed;
    }, 0);

    return shipValue + itemValue;
}

module.exports = { syncMarketPrices, loadMarketPrices, getPrice, calculateKillValue };
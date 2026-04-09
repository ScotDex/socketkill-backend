const CF_BASE = () => `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/r2/buckets/${process.env.CF_CACHE_BUCKET}/objects`;

const headers = () => ({
        'Authorization': `Bearer ${process.env.CF_R2_TOKEN}`,
        'Content-Type': 'application/json'
});


async function put(key, data) {
        try {
                const res = await fetch(`${CF_BASE()}/${key}`, {
                        method: 'PUT',
                        headers: headers(),
                        body: typeof data === 'string' ? data : JSON.stringify(data)
                });
                console.log(`[R2] PUT ${key} — ${res.status}`);
                return res.ok;
        } catch (err) {
                console.error(`[R2] PUT failed for ${key}:`, err.message);
                return false;
        }
}


async function get(key) {
        try {
                const res = await fetch(`${CF_BASE()}/${key}`, {
                        method: 'GET',
                        headers: headers()
                });
                if (!res.ok) return null;
                return await res.json();
        } catch (err) {
                console.error(`[R2] GET failed for ${key}:`, err.message);
                return null;
        }
}

module.exports = { put, get };
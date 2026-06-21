

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { execSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// ─── Config ───────────────────────────────────────────────────────────────

const SDE_BASE = 'https://developers.eveonline.com/static-data/tranquility';
const LATEST_URL = `${SDE_BASE}/latest.jsonl`;
const ZIP_URL = (build) => `${SDE_BASE}/eve-online-static-data-${build}-jsonl.zip`;

const CF_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID;
const CF_NAMESPACE = process.env.CF_KV_NAMESPACE_ID;

if (!CF_TOKEN || !CF_ACCOUNT || !CF_NAMESPACE) {
  console.error('Missing required env vars: CF_API_TOKEN, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID');
  process.exit(1);
}

const WORK_DIR = '/tmp/sde-sync';
const ZIP_PATH = path.join(WORK_DIR, 'sde.zip');
const EXTRACT_DIR = path.join(WORK_DIR, 'extracted');

// Files we actually care about. Anything not listed here is ignored.
const TABLES = ['mapSolarSystems', 'mapRegions', 'types', 'groups', 'categories'];

// ─── Cloudflare KV API ────────────────────────────────────────────────────

const KV_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${CF_NAMESPACE}`;
const authHeader = { Authorization: `Bearer ${CF_TOKEN}` };

async function kvGet(key) {
  const res = await fetch(`${KV_BASE}/values/${encodeURIComponent(key)}`, { headers: authHeader });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV GET ${key} failed: ${res.status}`);
  return await res.text();
}

async function kvPut(key, value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(`${KV_BASE}/values/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KV PUT ${key} failed: ${res.status} ${text}`);
  }
  console.log(`  ✓ wrote sde:${key.replace(/^sde:/, '')} (${(body.length / 1024).toFixed(1)} KB)`);
}

// ─── JSONL reader ─────────────────────────────────────────────────────────

async function* readJsonl(filepath) {
  const stream = fs.createReadStream(filepath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed);
  }
}

function getName(field) {
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object') return field.en ?? null;
  return null;
}

async function buildSystems() {
  const out = {};
  let firstRowLogged = false;
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'mapSolarSystems.jsonl'))) {
    if (row._key === '_meta') continue;
    if (!firstRowLogged) {
      console.log('  sample mapSolarSystems row keys:', Object.keys(row).join(', '));
      firstRowLogged = true;
    }
    out[row._key] = {
      name: getName(row.name),
      regionID: row.regionID ?? null,
      security: row.securityStatus ?? null,
    };
  }
  return out;
}

async function buildRegions() {
  const out = {};
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'mapRegions.jsonl'))) {
    if (row._key === '_meta') continue;
    out[row._key] = { name: getName(row.name) };
  }
  return out;
}

async function buildGroups() {
  const out = {};
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'groups.jsonl'))) {
    if (row._key === '_meta') continue;
    out[row._key] = {
      name: getName(row.name),
      categoryID: row.categoryID,
    };
  }
  return out;
}

async function buildCategories() {
  const out = {};
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'categories.jsonl'))) {
    if (row._key === '_meta') continue;
    out[row._key] = { name: getName(row.name) };
  }
  return out;
}

async function buildShips(groups) {
  const out = {};
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'types.jsonl'))) {
    if (row._key === '_meta') continue;
    const groupID = row.groupID;
    const group = groups[groupID];
    if (!group || group.categoryID !== 6) continue;  // Ship category only
    out[row._key] = {
      name: getName(row.name),
      groupID,
    };
  }
  return out;
}

async function buildItems(groups) {
  const out = {};
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'types.jsonl'))) {
    if (row._key === '_meta') continue;
    const groupID = row.groupID;
    const group = groups[groupID];
    if (!group) continue;
    const cat = group.categoryID;
    if (cat !== 7 && cat !== 18) continue;  // Modules + Drones
    out[row._key] = {
      name: getName(row.name),
      groupID,
    };
  }
  return out;
}


async function main() {
  console.log('Fetching stored sde:meta…');
  const storedRaw = await kvGet('sde:meta');
  const stored = storedRaw ? JSON.parse(storedRaw) : { etag: null, buildNumber: null };
  console.log(`  stored: build=${stored.buildNumber}, etag=${stored.etag || '(none)'}`);

  console.log(`Checking ${LATEST_URL}…`);
  const headRes = await fetch(LATEST_URL, {
    method: 'HEAD',
    headers: stored.etag ? { 'If-None-Match': stored.etag } : {},
  });

  if (headRes.status === 304) {
    console.log('304 Not Modified. Nothing to do.');
    return;
  }
  if (!headRes.ok) {
    throw new Error(`HEAD failed: ${headRes.status}`);
  }

  const newEtag = headRes.headers.get('etag');
  console.log(`  new etag: ${newEtag}`);

  const latestRes = await fetch(LATEST_URL);
  if (!latestRes.ok) throw new Error(`GET latest.jsonl failed: ${latestRes.status}`);
  const latestText = await latestRes.text();
  let newBuild = null;
  for (const line of latestText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed);
    if (row._key === 'sde') {
      newBuild = row.buildNumber;
      break;
    }
  }
  if (!newBuild) throw new Error('Could not parse build number from latest.jsonl');
  console.log(`  new build: ${newBuild}`);

  if (newBuild === stored.buildNumber) {
    console.log('Build unchanged. Updating ETag only.');
    await kvPut('sde:meta', {
      etag: newEtag,
      buildNumber: newBuild,
      lastSyncedAt: new Date().toISOString(),
    });
    return;
  }

  // Step 5: Download and extract.
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });

  const zipUrl = ZIP_URL(newBuild);
  console.log(`Downloading ${zipUrl}…`);
  const zipRes = await fetch(zipUrl);
  if (!zipRes.ok) throw new Error(`GET zip failed: ${zipRes.status}`);
  await pipeline(Readable.fromWeb(zipRes.body), fs.createWriteStream(ZIP_PATH));
  const sizeMB = (fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`  downloaded ${sizeMB} MB`);

  // Extract only the tables we need (saves disk + time).
  const filesArg = TABLES.map((t) => `'*${t}.jsonl'`).join(' ');
  console.log('Extracting target tables…');
  execSync(`unzip -j -o "${ZIP_PATH}" ${filesArg} -d "${EXTRACT_DIR}"`, { stdio: 'inherit' });

  // Verify all expected files are present.
  for (const t of TABLES) {
    const p = path.join(EXTRACT_DIR, `${t}.jsonl`);
    if (!fs.existsSync(p)) {
      throw new Error(`Expected file missing after extract: ${t}.jsonl`);
    }
  }

  // Step 6: Transform.
  console.log('Transforming…');
  const groups = await buildGroups();
  const categories = await buildCategories();
  const systems = await buildSystems();
  const regions = await buildRegions();
  const ships = await buildShips(groups);
  const items = await buildItems(groups);

  console.log(`  systems: ${Object.keys(systems).length}`);
  console.log(`  regions: ${Object.keys(regions).length}`);
  console.log(`  groups:  ${Object.keys(groups).length}`);
  console.log(`  categories: ${Object.keys(categories).length}`);
  console.log(`  ships:   ${Object.keys(ships).length}`);
  console.log(`  items:   ${Object.keys(items).length}`);

  // Step 7: Write to KV.
  console.log('Writing to KV…');
  await kvPut('sde:systems', systems);
  await kvPut('sde:regions', regions);
  await kvPut('sde:groups', groups);
  await kvPut('sde:categories', categories);
  await kvPut('sde:ships', ships);
  await kvPut('sde:items', items);

  // Step 8: Update meta.
  await kvPut('sde:meta', {
    etag: newEtag,
    buildNumber: newBuild,
    lastSyncedAt: new Date().toISOString(),
  });

  console.log(`Sync complete. Build ${stored.buildNumber || '(none)'} → ${newBuild}.`);
}

main().catch((err) => {
  console.error('SDE sync failed:', err);
  process.exit(1);
});
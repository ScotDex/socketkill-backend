

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

const TABLES = ['mapSolarSystems', 'mapRegions', 'types', 'groups', 'categories', 'typeDogma', 'metaGroups', 'factions'];

const FRIGATE_GROUP_NAMES = new Set ([
'Frigate', 'Assault Frigate', 'Interceptor', 'Covert Ops', 'Stealth Bomber',
  'Electronic Attack Ship', 'Logistics Frigate', 'Expedition Frigate',
])

const AMMO_GROUP_FAMILY = {
  'Projectile Ammo': 'Projectile',
  'Hybrid Charge': 'Hybrid',
  'Frequency Crystal': 'Laser',
  'Light Missile': 'Light Missiles',
  'Rocket': 'Rockets',
  'Advanced Light Missile': 'Advanced Light Missiles',
  'Advanced Rocket': 'Advanced Rockets',
};
const SIZED_AMMO_GROUPS = new Set(['Projectile Ammo', 'Hybrid Charge', 'Frequency Crystal']);

const DAMAGE_TYPES = ['EM', 'Thermal', 'Kinetic', 'Explosive'];
const RES_IDS = {
  shield: [271, 274, 273, 272],
  armor:  [267, 270, 269, 268],
  hull:   [113, 110, 109, 111],   
};
const DMG_IDS = [114, 118, 117, 116];
const CLASS_BY_META = { 1: 'T1', 2: 'T2', 4: 'Faction' };
const CHARGE_SIZE_ATTR = 128;


function shipClass(f, metaGroups) {
  if (f.metaGroupID == null) return f.techLevel === 2 ? 'T2' : 'T1';
  return CLASS_BY_META[f.metaGroupID] ?? metaGroups[f.metaGroupID]?.name ?? 'Unknown';
}

const VICTIM_CATEGORIES = new Set([
  6,   // Ship
  22,  // Deployable             
  23,  // Starbase               
  40,  // Sovereignty Structures 
  46,  // Orbitals               
  65,  // Structure            
  87,  // Fighter
  11, // Entity — NPC ships. 
]);

const SCHEMA_VERSION = 5;

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

const round4 = (n) => Math.round(n * 1e4) / 1e4;
const toResists = (attrs, ids) => ids.map(id => round4((1 - (attrs?.[id] ?? 1)) * 100));

const METRES_PER_LY = 9.4607e15;
function toLY(metres) {
  if (typeof metres !== 'number') return null;
  return Math.round((metres / METRES_PER_LY) * 1e4) / 1e4;
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
    const pos = row.position ?? null;
    out[row._key] = {
      name: getName(row.name),
      regionID: row.regionID ?? null,
      security: row.securityStatus ?? null,
      x: toLY(pos?.x),
      y: toLY(pos?.y),
      z: toLY(pos?.z),
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

async function buildFactions() {
  const out = {};
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'factions.jsonl'))) {
    if (row._key === '_meta') continue;
    out[row._key] = { name: getName(row.name) };
  }
  return out;
}

async function buildMetaGroups() {
  const out = {};
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'metaGroups.jsonl'))) {
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
  const tally = {};      
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'types.jsonl'))) {
    if (row._key === '_meta') continue;
    const groupID = row.groupID;
    const group = groups[groupID];
    if (!group || !VICTIM_CATEGORIES.has(group.categoryID)) continue;
    tally[group.categoryID] = (tally[group.categoryID] ?? 0) + 1;
    out[row._key] = {
      name: getName(row.name),
      groupID,
    };
  }
  console.log('  victim types by category:', tally);
  return out;
}

async function buildFrigateTypes(frigateGroupIds) {
  const out = {};     
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'types.jsonl'))) {
    if (row._key === '_meta') continue;
    if (!row.published || !frigateGroupIds.has(row.groupID)) continue;
    out[row._key] = {
  name: getName(row.name),
  groupID: row.groupID,
  metaGroupID: row.metaGroupID ?? null,
  techLevel: row.techLevel ?? null,
  factionID: row.factionID ?? null,
};
  }
  console.log(`  frigate types: ${Object.keys(out).length}`);
  return out;
}

function buildFrigateGuide({ build, frigates, ammo, dogma, groups, metaGroups, factions }) {
  const ships = Object.entries(frigates).map(([id, f]) => ({
    id: Number(id),
    name: f.name,
    group: groups[f.groupID]?.name ?? 'Unknown',
    class: shipClass(f, metaGroups),
    faction: factions[f.factionID]?.name ?? 'Unknown',
    res: {
      shield: toResists(dogma[id], RES_IDS.shield),
      armor:  toResists(dogma[id], RES_IDS.armor),
      hull:   toResists(dogma[id], RES_IDS.hull),
    },
  })).sort((a, b) => a.name.localeCompare(b.name));

  const ammoList = Object.entries(ammo)
    .filter(([id, a]) => !a.sized || dogma[id]?.[CHARGE_SIZE_ATTR] === 1)
    .map(([id, a]) => ({
      id: Number(id),
      name: a.name,
      family: a.family,
      dmg: DMG_IDS.map(d => round4(dogma[id]?.[d] ?? 0)),
    }))
    .sort((a, b) => a.id - b.id);

  return {
    sdeBuild: String(build),
    sdeFile: `eve-online-static-data-${build}-jsonl.zip`,
    damageTypes: DAMAGE_TYPES,
    ships,
    ammo: ammoList,
  };
}

async function buildAmmoTypes(ammoGroupFamilies) {
  const out = {};     
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'types.jsonl'))) {
    if (row._key === '_meta') continue;
    if (!row.published || !ammoGroupFamilies.has(row.groupID)) continue;
    const g = ammoGroupFamilies.get(row.groupID);
   out[row._key] = { name: getName(row.name), groupID: row.groupID, family: g.family, sized: g.sized };
  }
  console.log(`  ammo types: ${Object.keys(out).length}`);
  return out;
}

async function buildDogma(wantedIds) {
  const out = {};
  for await (const row of readJsonl(path.join(EXTRACT_DIR, 'typeDogma.jsonl'))) {
    if (row._key === '_meta') continue;
    if (!wantedIds.has(row._key)) continue;
    const attrs = {};
    for (const a of row.dogmaAttributes ?? []) attrs[a.attributeID] = a.value;
    out[row._key] = attrs;
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
  const schemaStale = stored.schemaVersion !== SCHEMA_VERSION;
  console.log(`  stored: build=${stored.buildNumber}, etag=${stored.etag || '(none)'}`);

  console.log(`Checking ${LATEST_URL}…`);
  const headRes = await fetch(LATEST_URL, {
    method: 'HEAD',
    headers: (stored.etag && !schemaStale) ? { 'If-None-Match': stored.etag } : {},
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

  if (newBuild === stored.buildNumber && !schemaStale) {
    console.log('Build unchanged. Updating ETag only.');
    await kvPut('sde:meta', {
      etag: newEtag,
      buildNumber: newBuild,
      schemaVersion: SCHEMA_VERSION,
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
  const frigateGroupIds = new Set(
     Object.entries(groups)
       .filter(([, g]) => FRIGATE_GROUP_NAMES.has(g.name))
       .map(([id]) => Number(id))
   );
  console.log(`  frigate groups: ${frigateGroupIds.size}/${FRIGATE_GROUP_NAMES.size}`);
  const ammoGroupFamilies = new Map(
    Object.entries(groups)
      .filter(([, g]) => AMMO_GROUP_FAMILY[g.name])
      .map(([id, g]) => [Number(id), { family: AMMO_GROUP_FAMILY[g.name], sized: SIZED_AMMO_GROUPS.has(g.name) }])
  );
  console.log(`  ammo groups: ${ammoGroupFamilies.size}/${Object.keys(AMMO_GROUP_FAMILY).length}`);
  const metaGroups = await buildMetaGroups();
  const factions = await buildFactions();
  const frigates = await buildFrigateTypes(frigateGroupIds);
  const ammo = await buildAmmoTypes(ammoGroupFamilies);
  const wantedIds = new Set([...Object.keys(frigates), ...Object.keys(ammo)].map(Number));
  const dogma = await buildDogma(wantedIds);
  console.log(`  dogma rows: ${Object.keys(dogma).length} (frigates + ammo: ${wantedIds.size}) | metaGroups: ${Object.keys(metaGroups).length} | factions: ${Object.keys(factions).length}`);
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
  const guide = buildFrigateGuide({ build: newBuild, frigates, ammo, dogma, groups, metaGroups, factions });
  console.log(`  guide: ${guide.ships.length} ships, ${guide.ammo.length} ammo`);
  fs.writeFileSync(path.join(WORK_DIR, 'frigates.json'), JSON.stringify(guide, null, 2));
  if (process.env.DRY_RUN) { console.log('DRY_RUN: skipping KV writes'); return; }
  // Step 7: Write to KV.
  console.log('Writing to KV…');
  await kvPut('sde:systems', systems);
  await kvPut('sde:regions', regions);
  await kvPut('sde:groups', groups);
  await kvPut('sde:categories', categories);
  await kvPut('sde:ships', ships);
  await kvPut('sde:items', items);
  await kvPut('sde:frigateGuide', guide); 

  // Step 8: Update meta.
  await kvPut('sde:meta', {
    etag: newEtag,
    buildNumber: newBuild,
    schemaVersion: SCHEMA_VERSION,
    lastSyncedAt: new Date().toISOString(),
  });

  console.log(`Sync complete. Build ${stored.buildNumber || '(none)'} → ${newBuild}.`);
}

main().catch((err) => {
  console.error('SDE sync failed:', err);
  process.exit(1);
});
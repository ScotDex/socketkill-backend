const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const satoriModule = require('satori');
const satori = satoriModule.default || satoriModule;
const exo = fs.readFileSync(path.join(__dirname, '..', '..', 'fonts', 'Exo2-SemiBold.ttf'));
const mono = fs.readFileSync(path.join(__dirname, '..', '..', 'fonts', 'ShareTechMono-Regular.ttf'));

const C = {
  green: '#3fb950',
  billion: '#ff7b72',
  whale: '#f2cc60',
  blue: '#58a6ff',
  faint: 'rgba(255,255,255,0.55)',
  bg: '#0a0b0e',
};

function classifySecurity(system) {
  if (!system || system.security == null) return { word: 'UNKNOWN', num: null, color: C.faint };
  if (system.id >= 31000000 && system.id < 32000000) return { word: 'WORMHOLE', num: null, color: C.blue };
  if (system.regionID === 10000070 || system.region === 'Pochven') return { word: 'POCHVEN', num: null, color: '#b07ce8' };
  const s = system.security;
  const num = s.toFixed(1);
  if (s >= 0.5) return { word: 'HIGHSEC', num, color: C.green };
  if (s > 0.0) return { word: 'LOWSEC', num, color: C.whale };
  return { word: 'NULLSEC', num, color: C.billion };
}

function parseIsk(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const m = v.match(/([\d.,]+)\s*([KMBT])?/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ''));
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]?.toUpperCase()] ?? 1;
  return n * mult;
}

async function renderOgCard(kill) {
  const totalIsk = kill.rawValue ?? parseIsk(kill.totalValue);
  const tierColor =
    totalIsk >= 10_000_000_000 ? C.whale
      : totalIsk >= 1_000_000_000 ? C.billion
        : C.green;
  const sec = classifySecurity(kill.system);

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: 1200, height: 630, display: 'flex', position: 'relative',
          backgroundColor: C.bg, fontFamily: 'Exo',
        },
        children: [
          {
            type: 'img',
            props: {
              src: `https://images.evetech.net/types/${kill.victim.shipTypeID}/render?size=512`,
              width: 1200, height: 1200,
              style: { position: 'absolute', top: -240, left: 0 },
            },
          },
          {
            type: 'div',
            props: {
              style: {
                position: 'absolute', top: 0, left: 0, width: 1200, height: 630,
                backgroundImage:
                  'linear-gradient(180deg, rgba(10,12,16,0.10) 0%, rgba(10,12,16,0.40) 55%, rgba(10,12,16,0.92) 100%)',
              },
            },
          },
          {
            type: 'div',
            props: {
              style: {
                display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                position: 'relative', width: '100%', height: '100%', padding: 48,
              },
              children: [
                { type: 'div', props: { style: { fontSize: 54, fontWeight: 600, color: '#ffffff' }, children: kill.victim.name } },
                { type: 'div', props: { style: { fontSize: 32, color: C.faint }, children: `lost a ${kill.victim.ship}` } },
                ...(kill.totalValue ? [{
                  type: 'div',
                  props: { style: { fontFamily: 'Mono', fontSize: 64, color: tierColor }, children: `${kill.totalValue} ISK` },
                }] : []),
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: 12 },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: { display: 'flex', fontFamily: 'Mono', fontSize: 32 },
                          children: [
                            { type: 'div', props: { style: { color: sec.num ? '#ffffff' : sec.color }, children: sec.word } },
                            ...(sec.num ? [{ type: 'div', props: { style: { color: sec.color, marginLeft: 12 }, children: sec.num } }] : []),
                            { type: 'div', props: { style: { color: '#ffffff', marginLeft: 12 }, children: `· ${kill.system.name} · ${kill.system.region}` } },
                          ],
                        },
                      },
                      { type: 'div', props: { style: { fontFamily: 'Mono', fontSize: 32, letterSpacing: 4, color: C.green }, children: 'SOCKETKILL.COM' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: 1200, height: 630,
      fonts: [
        { name: 'Exo', data: exo, weight: 600 },
        { name: 'Mono', data: mono, weight: 400 },
      ],
    }
  );

  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}

module.exports = { renderOgCard };
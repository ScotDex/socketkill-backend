const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const satoriModule = require('satori');
const satori = satoriModule.default || satoriModule;
const exo = fs.readFileSync(path.join(__dirname, '..', '..', 'fonts', 'Exo2-SemiBold.ttf'));
const mono = fs.readFileSync(path.join(__dirname, '..', '..', 'fonts', 'ShareTechMono-Regular.ttf'));
const { TITAN_SHIP_IDS, SUPER_SHIP_IDS, DREAD_SHIP_IDS } = require('../core/relayShipIDs');
const { AT_SHIP_IDS, OFFICER_SHIP_IDS } = require('../core/shipIDs');

const HOME_SHIP_POOL = [...new Set([
  ...TITAN_SHIP_IDS,
  ...SUPER_SHIP_IDS,
  ...DREAD_SHIP_IDS,
  ...AT_SHIP_IDS,
  ...OFFICER_SHIP_IDS,
])];

const C = {
  green: '#3fb950',
  faint: 'rgba(255,255,255,0.65)',
  bg: '#0a0b0e',
};

const PAGES = {
  home: { description: 'See yourself die in an atmospheric and aesthetically pleasing way.' },
};

const STAMP = {
  SIZE: 320, COL: 440, BOTTOM: 48, RIGHT: 48, RADIUS: 8,
  BORDER: 'rgba(255,255,255,0.15)',
  NAME_SIZE: 30, NAME_GAP: 10, NAME_SLOT: 84,
  FADE: 0.72,       // depth of the right-edge darkening behind logos
  FADE_START: 45,   // % across the card where the darkening begins
};

const ENTITY = {
  pilot: {
    image: id => `https://images.evetech.net/characters/${id}/portrait?size=512`,
    stampStyle: {
      borderRadius: STAMP.RADIUS,
      border: `1px solid ${STAMP.BORDER}`,
    },
    fade: false,
  },
  corp: {
    image: id => `https://images.evetech.net/corporations/${id}/logo?size=256`,
    stampStyle: {},
    fade: true,
  },
  alliance: {
    image: id => `https://images.evetech.net/alliances/${id}/logo?size=128`,
    stampStyle: {},
    fade: true,
  },
};

async function renderPageCard(key) {
  const page = PAGES[key];
  if (!page) return null;

  const ship = HOME_SHIP_POOL[Math.floor(Math.random() * HOME_SHIP_POOL.length)];

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
              src: `https://images.evetech.net/types/${ship}/render?size=512`,
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
                {
                  type: 'div',
                  props: {
                    style: { fontFamily: 'Mono', fontSize: 72, letterSpacing: 6, color: C.green },
                    children: 'SOCKETKILL.COM',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 32, color: C.faint, marginTop: 16, width: 900, lineHeight: 1.35, flexWrap: 'wrap' },
                    children: page.description,
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


async function renderEntityCard({ type, id, name, description, shipTypeID }) {
  const conf = ENTITY[type];
  if (!conf) return null;
  const ship = shipTypeID ?? HOME_SHIP_POOL[id % HOME_SHIP_POOL.length];

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
              src: `https://images.evetech.net/types/${ship}/render?size=512`,
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
          ...(conf.fade ? [{
            type: 'div',
            props: {
              style: {
                position: 'absolute', top: 0, left: 0, width: 1200, height: 630,
                backgroundImage:
                  `linear-gradient(90deg, rgba(10,12,16,0) ${STAMP.FADE_START}%, rgba(10,12,16,${STAMP.FADE}) 100%)`,
              },
            },
          }] : []),
          {
            type: 'div',
            props: {
              style: {
                position: 'absolute', bottom: STAMP.BOTTOM, right: STAMP.RIGHT,
                width: STAMP.COL,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              },
              children: [
                {
                  type: 'img',
                  props: {
                    src: conf.image(id),
                    width: STAMP.SIZE, height: STAMP.SIZE,
                    style: conf.stampStyle,
                  },
                },
                {
                  /* textAlign is ignored by Satori unless flexWrap is
                     also set — both are required to centre each line. */
                  type: 'div',
                  props: {
                    style: {
                      fontSize: STAMP.NAME_SIZE, fontWeight: 600, color: '#ffffff',
                      marginTop: STAMP.NAME_GAP,
                      width: STAMP.COL, height: STAMP.NAME_SLOT,
                      display: 'flex', justifyContent: 'center', flexWrap: 'wrap',
                      textAlign: 'center', alignContent: 'flex-start',
                    },
                    children: name,
                  },
                },
              ],
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
                {
                  type: 'div',
                  props: {
                    style: { fontFamily: 'Mono', fontSize: 72, letterSpacing: 6, color: C.green },
                    children: 'SOCKETKILL.COM',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 32, color: C.faint, marginTop: 16, width: 700, lineHeight: 1.35, flexWrap: 'wrap' },
                    children: description,
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

module.exports = { renderPageCard, PAGES, renderEntityCard };

// forcing workers to do their jobs
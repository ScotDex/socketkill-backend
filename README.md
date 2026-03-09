# Socket.Kill

A high-performance, real-time EVE Online killmail streaming platform. Socket.Kill ingests killmails from the zKillboard R2 feed and broadcasts them live to connected clients via WebSocket.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/X7X21RDFR0)

## Features

- **Real-time killmail streaming** via WebSocket
- **Region filtering** — filter the live feed by EVE region
- **Whale alerts** — automatic flagging of high-value kills
- **Corp intel webhooks** — Discord notifications for corporation-specific kills
- **Image proxy API** — low-latency ship renders, corporation logos, and market item icons via Cloudflare edge
- **EVE SSO** — player count and server status integration

## Architecture

```
zKillboard R2 Feed → R2 Background Worker → Processor → WebSocket Broadcast
                                                       → Discord Webhooks
                                                       → Stats Manager
```

- **Runtime:** Node.js
- **Transport:** Socket.io (WebSocket + polling fallback)
- **Infrastructure:** DigitalOcean VM + Cloudflare R2 + Cloudflare Edge
- **ESI:** EVE Swagger Interface for character, corporation, and universe data

## API

A public image proxy API is available for EVE Online assets. Free to use for personal and third-party projects. If you integrate this API into your tool or application, a credit link back to [socketkill.com](https://socketkill.com) is appreciated.

Full API documentation is available at [socketkill.com/docs](https://socketkill.com/docs).

## WebSocket Access

A real-time killmail stream is available via WebSocket for approved integrations. Access is whitelist-based. If you would like to connect your application to the live feed, please get in touch to discuss your use case.

## Legal

EVE Online and the EVE logo are registered trademarks of CCP hf. All rights are reserved worldwide.

All other trademarks are the property of their respective owners. EVE Online, the EVE logo, EVE, and all associated logos and designs are the intellectual property of CCP hf. All artwork, screenshots, characters, vehicles, storylines, world facts, or other recognizable features of the intellectual property relating to these trademarks are likewise the intellectual property of CCP hf.

CCP hf. has granted permission to socketkill.com to use EVE Online and all associated logos and designs for promotional and informational purposes on its website but does not endorse, and is not in any way affiliated with, socketkill.com.

CCP is in no way responsible for the content on or functioning of this website, nor can it be liable for any damage arising from the use of this website.


## Credits

Built by [@ScottishDex](https://zkillboard.com) • Powered by [zKillboard](https://zkillboard.com) • [socketkill.com](https://socketkill.com)
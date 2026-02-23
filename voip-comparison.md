# VoIP Providers Comparison for CRM Integration

> Context: evaluating VoIP options for CRM telephony integration (calls from browser, call logging, recording). **Must work in Russia.**

## Russia Availability

| Provider | Available in Russia | Notes |
|---|---|---|
| **Novofon** (ex-Zadarma RU) | Yes | Zadarma rebranded to Novofon for Russia in 2022. Same API, same features. |
| **Voximplant** | Yes | Russian company (HQ in Moscow). Full operations in Russia. |
| **Mango Office** | Yes | Russian company. Industry standard for Russian CRM telephony. |
| **Telphin** | Yes | Russian company. Top-5 IP telephony provider in Russia. |
| **Sipuni** | Yes | Russian company. Focused on CRM integrations. |
| ~~Zadarma~~ | **No** | Left Russia in March 2022. Operates in 160 other countries. |
| ~~Twilio~~ | **No** | No Russian numbers, payment restrictions. |
| ~~Vonage / Plivo~~ | **No** | Similar restrictions as Twilio. |

## Quick Summary

| Need | Best pick |
|---|---|
| Fastest prototype | **Novofon** — free PBX, WebRTC widget, same API as Zadarma, cheapest |
| Most flexible / future-proof | **Voximplant** — full SDK, programmable call scenarios, AI integrations |
| Enterprise RU market / amoCRM-like | **Mango Office** — industry standard in Russian CRMs |

## Detailed Comparison: Novofon vs Voximplant vs Mango Office

### Developer Experience & Integration

| | Novofon | Voximplant | Mango Office |
|---|---|---|---|
| API style | REST API (HMAC-SHA1 auth) | REST + serverless scenarios (VoxEngine JS) | REST API (VPBX API) |
| API domain | `api.novofon.com` (+ sandbox at `api-sandbox.novofon.com`) | `voximplant.ru` | `mango-office.ru` |
| WebRTC | Embeddable widget + `GET /v1/webrtc/get_key` | Full SDK (Web, iOS, Android, React Native, Flutter) | No built-in WebRTC; SIP softphone or partner widgets |
| Docs quality | Good — Russian docs, same structure as Zadarma | Excellent — Russian + English, cloud IDE, debugger, Discord | Russian-only, enterprise-oriented |
| NPM package | No SDK — embed via script tag + `zadarmaWidgetFn()` | `voximplant-websdk` — maintained, typed | No SDK — HTTP callbacks |
| Custom call logic | PBX config via dashboard, limited programmatic control | VoxEngine scenarios (JS in cloud) — IVR, recording, routing, AI | PBX config via dashboard, callback-based events |
| Webhook events | `NOTIFY_START`, `NOTIFY_ANSWER`, `NOTIFY_END`, `NOTIFY_OUT_START`, `NOTIFY_OUT_END`, `NOTIFY_RECORD` | Real-time via VoxEngine scenarios | Callback API |
| Time to first call | ~1 hour | ~2–3 hours | ~1–2 days (requires sales contact) |
| GitHub | [novofon](https://novofon.github.io/data_api/) — API docs | [Active repos](https://github.com/voximplant) — SDK examples | None |

### Pricing

| | Novofon | Voximplant | Mango Office |
|---|---|---|---|
| Entry cost | **0 ₽/mo** — free base plan, pay only for calls | Free "Explorer" plan; paid from ~$100/mo | From ~685 ₽/mo (PBX) + 1 000 ₽/mo (API access) |
| RU number (city) | From ~150 ₽/mo (80+ cities) | Available (pricing on request) | ~500–1 000 ₽/mo |
| RU mobile number | Available | Available | Available |
| 8-800 number | Available | Available | Available |
| Calls to RU mobile | **~1.98 ₽/min** (per-second billing) | ~2–5 ₽/min | ~2.0 ₽/min |
| Calls to RU landline | ~0.95 ₽/min | ~1–2 ₽/min | ~1.5 ₽/min |
| Connection fee | None | None | None |
| Billing | Per second | Per second | Per second |
| Call recording | **Free** (included in PBX) | Built-in | Included |
| API access | **Free** (included) | Included in plan | **Paid extra** (1 000–5 500 ₽/mo) |
| **Min. spend for prototype** | **~150 ₽/mo** (number only) | **~$0** (free tier, no number) | **~1 700 ₽/mo** minimum |

### CRM Integration Fit

| | Novofon | Voximplant | Mango Office |
|---|---|---|---|
| Best for | Quick "phone in browser" with minimal code | Custom call flows, AI voice, full control | Enterprise-grade, out-of-box CRM telephony |
| Call recording | Free, stored 180 days, downloadable via API | Built-in, programmable | Included |
| Call events / webhooks | 6 webhook event types for full call lifecycle | Real-time via VoxEngine scenarios | Callback API |
| Integration effort | **Low** — embed widget, hook webhooks via API | Medium — write VoxEngine scenario + embed SDK | Medium-High — setup PBX, configure API callbacks, sales contact |
| Ready CRM integrations | amoCRM, Bitrix24, Megaplan, others | Bitrix24, custom via SDK | 80+ ready-made CRM integrations |
| Scalability | Medium (good for SMB) | High (cloud, global infra) | High (enterprise RU market) |
| Lock-in risk | **Low** (standard SIP) | Medium (proprietary scenarios) | High (proprietary ecosystem) |

## Pros & Cons

### Novofon (ex-Zadarma for Russia)

**Pros:**
- Fastest to integrate — embed WebRTC widget in under an hour
- Free cloud PBX with call recording included
- Cheapest option — 0 ₽/mo base, ~2 ₽/min for calls
- Free API access (no extra charge)
- 6 webhook events covering full call lifecycle + recordings
- Standard SIP — easy to swap providers later
- 14+ years on market, 2M+ clients
- Sandbox API for development (`api-sandbox.novofon.com`)

**Cons:**
- No proper SDK — script tag widget embed only
- Limited programmatic control over call flows
- Widget customization is basic
- Less suitable for complex call routing or AI features
- Russian docs primarily

### Voximplant

**Pros:**
- Full-featured Web SDK with TypeScript support
- Programmable call scenarios (IVR, AI, routing) via cloud JS
- SDKs for every platform (Web, iOS, Android, React Native, Flutter)
- Built-in call recording, transcription, speech recognition
- Free tier for prototyping
- Russian company — full support in Russia
- Best developer experience and documentation

**Cons:**
- Higher learning curve (VoxEngine scenario model)
- Paid plans start at ~$100/mo — expensive for MVP
- Proprietary scenario language = some vendor lock-in
- Overkill for simple click-to-call + recording

### Mango Office

**Pros:**
- Industry standard for Russian CRM telephony (amoCRM uses it)
- 80+ ready-made CRM integrations
- Full-featured PBX with call tracking, analytics, speech recognition
- Strong enterprise support and SLAs
- Familiar to Russian businesses (easier client adoption)

**Cons:**
- Slowest to integrate — requires sales contact and setup
- API access costs extra (1 000–5 500 ₽/mo on top of PBX)
- Russian-only documentation
- No WebRTC SDK — relies on SIP softphones or partner widgets
- Highest minimum monthly spend (~1 700 ₽/mo)
- Most vendor lock-in

## Also Available (Not Compared in Detail)

| Provider | Notes |
|---|---|
| **Telphin** | Top-5 in Russia, 100+ ready CRM integrations, open API, ~same pricing as Mango. Good option if Mango-like features needed with better API. |
| **Sipuni** | Focused on amoCRM/Bitrix24 integration. Webhooks + API. Less flexible for custom CRM integration. |
| **MCN Telecom** | Enterprise SIP trunking provider. Good for self-hosted Asterisk setups. |

## Recommendation

For a **prototype CRM**, start with **Novofon**:

1. Embed their WebRTC widget into the React frontend for browser-based calls
2. Hook call lifecycle webhooks (`NOTIFY_START` → `NOTIFY_END` → `NOTIFY_RECORD`) into the existing conversation/activity system
3. Fetch call recordings via API and attach to activity logs
4. Log calls as activities linked to contacts/deals
5. Standard SIP means easy migration to Voximplant or Mango later if needed

If you need **AI voice bots, complex IVR, or programmable call routing** later, migrate to **Voximplant**.

If you need **enterprise features and amoCRM-like telephony** for production, migrate to **Mango Office**.

## Links

### Novofon
- [Main site](https://novofon.com/)
- [API Documentation](https://api.novofon.com/)
- [API v2 Docs (GitHub)](https://novofon.github.io/data_api/)
- [CRM Integration Guide](https://novofon.com/instructions/integration/own-crm-with-voip/)
- [WebRTC Widget](https://novofon.com/instructions/integration/own-crm/)
- [Tariffs](https://novofon.com/tariffs/)
- [Russian Numbers](https://novofon.com/numbers/russian-federation/)
- [Call Prices](https://novofon.com/prices/)

### Voximplant
- [Platform (RU)](https://voximplant.ru/platform)
- [Pricing (RU)](https://voximplant.ru/pricing)
- [Platform (EN)](https://voximplant.com/platform)
- [Web SDK Docs](https://voximplant.com/docs/references/websdk/voximplant/client)
- [GitHub](https://github.com/voximplant)

### Mango Office
- [PBX Pricing](https://www.mango-office.ru/products/virtualnaya_ats/price/)
- [API](https://www.mango-office.ru/products/integraciya/api/)
- [Integration Pricing](https://www.mango-office.ru/products/integraciya/price/)

# VoIP Providers Comparison: Voximplant vs Zadarma vs Mango Office

> Context: evaluating VoIP options for CRM telephony integration (calls from browser, call logging, recording). Must work in Russia.

## Quick Summary

| Need | Best pick |
|---|---|
| Fastest prototype | **Zadarma** — embed widget, get a number, done in an hour |
| Most flexible / future-proof | **Voximplant** — proper SDK, programmable call logic, AI integrations |
| Enterprise RU market / amoCRM-like | **Mango Office** — industry standard in Russian CRMs |

## Developer Experience & Integration

| | Voximplant | Zadarma | Mango Office |
|---|---|---|---|
| API style | REST + serverless scenarios (VoxEngine JS) | REST API | REST API (VPBX API) |
| WebRTC | Full SDK (Web, iOS, Android, React Native, Flutter) | Embeddable widget + API key generation | No built-in WebRTC; SIP softphone or widget via partners |
| Docs quality | Excellent — English docs, code samples, cloud IDE with debugger, Discord community | Decent — English docs available, sparser examples | Russian-only docs, enterprise-oriented, less developer-friendly |
| NPM package | `voximplant-websdk` — maintained, typed | No SDK — embed via script tag + `zadarmaWidgetFn()` | No SDK — HTTP callbacks |
| Custom call logic | VoxEngine scenarios (JS in cloud) — IVR, recording, routing, AI | PBX config via dashboard, limited programmatic control | PBX config via dashboard, callback-based events |
| Time to first call | ~2–3 hours | ~1 hour | ~1–2 days (requires sales contact) |
| GitHub presence | [Active repos](https://github.com/voximplant), SDK examples | Minimal | None |

## Pricing

| | Voximplant | Zadarma | Mango Office |
|---|---|---|---|
| Entry cost | Free tier available; paid plans from ~$100/mo | Free PBX; pay only for numbers + minutes | From ~685 ₽/mo (PBX) + 1 000 ₽/mo (API access) |
| RU number rental | Available (pricing on request) | ~€3–5/mo | ~500–1 000 ₽/mo |
| Calls to RU landline | ~$0.01–0.02/min | €0.016/min (~1.5 ₽) | ~1.5 ₽/min |
| Calls to RU mobile | ~$0.02–0.05/min | €0.024/min (~2.2 ₽) | ~2.0 ₽/min |
| Connection fee | None | None | None |
| Billing granularity | Per second | Per second (Standard+) | Per second |
| **Min. spend for prototype** | **~$0** (free tier) | **~$5–10/mo** (number only) | **~1 700 ₽/mo** (~$18) |

## CRM Integration Fit

| | Voximplant | Zadarma | Mango Office |
|---|---|---|---|
| Best for | Custom call flows, AI voice, full control | Quick "phone in browser" with minimal code | Enterprise-grade, out-of-box CRM telephony |
| Call recording | Built-in | Free on PBX | Included |
| Call events / webhooks | Real-time via VoxEngine scenarios | Webhook notifications | Callback API |
| Integration effort | Medium — write VoxEngine scenario + embed SDK | Low — embed widget, hook call events via API | Medium-High — setup PBX, configure API callbacks |
| Scalability | High (cloud, global infra) | Medium (good for SMB) | High (enterprise RU market) |
| Lock-in risk | Medium (proprietary scenarios) | Low (standard SIP under the hood) | High (proprietary ecosystem) |

## Pros & Cons

### Voximplant

**Pros:**
- Full-featured Web SDK with TypeScript support
- Programmable call scenarios (IVR, AI, routing) via cloud JS
- SDKs for every platform (Web, iOS, Android, React Native, Flutter)
- Built-in call recording, transcription, speech recognition
- Free tier for prototyping
- Good English documentation and community

**Cons:**
- Higher learning curve (VoxEngine scenario model)
- Paid plans start at $100/mo — expensive for MVP
- Proprietary scenario language = some vendor lock-in

### Zadarma

**Pros:**
- Fastest to integrate — embed widget in under an hour
- Free cloud PBX included
- Cheapest for prototyping (~$5–10/mo)
- Standard SIP — easy to swap providers later
- English docs and dashboard available
- Per-second billing on Standard+ plans

**Cons:**
- No proper SDK — script tag embed only
- Limited programmatic control over call flows
- Widget customization is basic
- Less suitable for complex call routing or AI features

### Mango Office

**Pros:**
- Industry standard for Russian CRM telephony
- 80+ ready-made CRM integrations
- Full-featured PBX with call tracking, analytics, speech recognition
- Strong enterprise support and SLAs
- Familiar to Russian businesses (easier client adoption)

**Cons:**
- Slowest to integrate — requires sales contact and setup
- API access costs extra (1 000–5 500 ₽/mo on top of PBX)
- Russian-only documentation
- No WebRTC SDK — relies on SIP softphones or partner widgets
- Highest minimum monthly spend
- Most vendor lock-in

## Recommendation

For a **prototype**, start with **Zadarma**:

1. Embed their web phone widget into the React frontend
2. Hook call events (start, end, recording URL) into the existing conversation system via webhooks
3. Log calls as activities linked to contacts/deals
4. Standard SIP means easy migration to Voximplant or Mango later if needed

## Links

- Voximplant: [Platform](https://voximplant.com/platform) · [Pricing](https://voximplant.com/pricing) · [Web SDK Docs](https://voximplant.com/docs/references/websdk/voximplant/client) · [GitHub](https://github.com/voximplant)
- Zadarma: [Tariffs](https://zadarma.com/en/tariffs/plans/) · [Russia Rates](https://zadarma.com/en/tariffs/calls/russia/) · [Web Phone](https://zadarma.com/en/blog/web-phone/) · [API Docs](https://zadarma.com/en/support/api/)
- Mango Office: [PBX Pricing](https://www.mango-office.ru/products/virtualnaya_ats/price/) · [API](https://www.mango-office.ru/products/integraciya/api/) · [Integration Pricing](https://www.mango-office.ru/products/integraciya/price/)

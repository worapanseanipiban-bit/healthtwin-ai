# HealthTwin AI — your digital health twin

**U-Hackathon 2026 · AI track.** HealthTwin AI turns a person's own health data (profile, chronic conditions, allergies, medicines, blood tests, heart rate, training plan) into a living "digital twin". It shows how medicines affect each organ, and it includes an AI assistant that answers questions **from the user's own data**.

## The problem
In Thailand people often self-medicate with household medicines (paracetamol, NSAIDs, antihistamines, cold remedies). Common mistakes are:
- taking two drugs of the same class;
- going over the daily maximum, because paracetamol is hidden in cold remedies;
- ignoring a condition such as kidney disease, an ulcer, pregnancy or anticoagulants.

Lab reports arrive as paper that people don't understand or track over time. Generic chatbots don't know the person's medicines, conditions or lab history, so their advice is generic.

## What it does
| Feature | Details |
|---|---|
| Home dashboard | Age, BMI (Asian cut-offs), latest blood results, medication adherence ring, live heart rate |
| Virtual body (digital twin) | A realistic body map. Each organ is recoloured by the medicine's effect: target / side effect / risk. It also shows alcohol, empty-stomach and overdose scenarios. |
| Medicines & body | 22 built-in Thai household drugs. AI lookup covers any other drug. Rules adjust for 11 conditions (kidney, liver, ulcer, pregnancy, elderly 65+, …). |
| My medicines | Dose log, 24-hour total vs max (reduced for conditions), minimum gap between doses, interaction and allergy alerts |
| Blood results | Records grouped by test, with trend charts against the reference band and ▲▼ changes |
| Live pulse | Real smartwatch over Web Bluetooth (Heart Rate service), or simulated data |
| Personal trainer | A weekly programme built from goal, level, equipment and injuries, with safe substitutions |
| **AI health assistant (Claude)** | Chat in Thai grounded in the user's data. It reads photos of drug labels and lab reports, and proposes actions (log dose, add medicine, save lab results, open a page) as buttons the user must confirm. |
| **Voice assistant (ElevenLabs Agents)** | Talk to HealthTwin hands-free. It gets the same user summary and can open pages or log a dose. |
| Accounts & privacy | Firebase Auth (email + Google). Firestore rules allow each user only `data/users/{uid}/**`. No health data is cached in the browser. |
| Installable PWA | Works offline (app shell) on phone and desktop |

## How AI is used
1. **Claude API — chat assistant** (`netlify/functions/chat.mjs`)
   - The browser sends the chat plus a compact summary of the user's data. It does not send the raw database.
   - The function verifies the Firebase ID token, applies a daily per-user quota, and streams Claude's reply back as NDJSON.
   - Claude has 4 strict tools. Tool calls are **proposals only**: the app shows each one as a confirm card, and nothing changes until the user taps it. Safety checks (allergy, daily max, dose interval) are recomputed by the app at confirm time.
   - The system prompt is cached, effort is low (fast replies), refusal stop reasons are handled, and server-side fallbacks are on.
   - Emergency keywords (chest pain, stroke signs, overdose, self-harm…) show a 1669 / 1323 banner client-side, even before the model answers.
2. **Claude — drug lookup.** For medicines that are not in the built-in list, Claude returns structured JSON (dose, max, organ effects, condition rules). The app validates and sanitises it before use.
3. **ElevenLabs Agents — voice.** The `<elevenlabs-convai>` widget gets `{{user_context}}` as a dynamic variable. Client tools `open_page`, `log_dose` and `show_emergency` run in the page, and `log_dose` refuses allergy or over-max doses itself.

## Architecture
```
Browser (PWA, single page)
 ├─ Firebase Auth + Firestore  (data/users/{uid}/state, …/profile/blood)
 ├─ POST /api/chat  ──►  Netlify Function ──► Claude API (streaming, tools)
 │                        verifies Firebase ID token, daily quota (Netlify Blobs)
 └─ ElevenLabs Agent widget (voice) ──► client tools in the page
```

## Run / deploy
1. Push this repo to GitHub. In Netlify choose **Add new site → Import an existing project**. Netlify reads `netlify.toml` (publish `public/`, functions `netlify/functions/`).
2. Netlify → Site configuration → Environment variables:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com. Set a monthly spend limit there.
   - optional `CHAT_DAILY_LIMIT` (default 40 messages per user per day).
3. Firebase console:
   - Authentication → Settings → Authorized domains → add your `*.netlify.app` domain.
   - Firestore → Rules → paste `firestore.rules`.
4. Voice: create an agent at elevenlabs.io → Agents (see `docs/elevenlabs-agent.md`). Then put its ID in `public/firebase-config.js` as `window.HT_ELEVENLABS_AGENT_ID`.

## Safety notes
HealthTwin gives general health information and tracking, not a diagnosis. Every AI action needs the user's confirmation. Medicine limits come from built-in rules, not from the model. Emergency guidance always points to 1669.

## Tech
Vanilla JS + Tailwind v4 · Chart.js · Firebase (Auth, Firestore) · Netlify Functions · Anthropic TypeScript SDK · ElevenLabs Agents · Web Bluetooth · PWA

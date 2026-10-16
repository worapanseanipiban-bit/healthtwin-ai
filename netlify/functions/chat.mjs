// HealthTwin AI assistant: Netlify Function that relays the chat to Claude.
// - The Anthropic API key stays here (env ANTHROPIC_API_KEY), never in the page.
// - Only signed-in Firebase users may call it (ID token checked against Google's public keys).
// - Each user gets a daily message quota so nobody can drain the credit.
// - The reply streams back as NDJSON lines: {type:"text"|"action"|"notice"|"error"|"done", ...}
import Anthropic from "@anthropic-ai/sdk";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getStore } from "@netlify/blobs";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "healthtwin-13f6e";
const DAILY_LIMIT = Number(process.env.CHAT_DAILY_LIMIT || 40);
const MODEL = "claude-opus-5-5";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const client = new Anthropic();

const SYSTEM = `You are the health assistant inside HealthTwin AI, a personal health app used in Thailand.

How to answer
- Reply in Thai unless the user writes in another language. Be warm, plain and short: about 120 words unless the user asks for detail. Use short paragraphs or a few bullet points; no tables.
- Ground every answer in the user's own data (profile, conditions, allergies, medicines and today's doses, blood results, training plan), which is given below under "ข้อมูลผู้ใช้". Say which data you used. If something you need is missing, say so and suggest adding it in the app.
- You give general health information, not a diagnosis or a prescription. For prescription-only medicines, dose changes or anything uncertain, advise asking a doctor or pharmacist.

Medicines
- Before suggesting any medicine, check allergies, chronic conditions, the user's current medicines (duplicates such as two NSAIDs, interactions) and today's total against the maximum daily dose. If the user is allergic or a condition makes it unsafe, say so clearly and offer a safer option.
- Paracetamol is often hidden in cold remedies; remind the user to count it.

Emergencies
- If the user describes chest pain, trouble breathing, signs of stroke (face drooping, arm weakness, slurred speech), fainting, seizures, severe bleeding, a severe allergic reaction, an overdose or thoughts of self-harm: tell them to call 1669 (Thai emergency services) now, or 1323 for mental-health crisis support, before anything else. Keep that reply very short.

Photos
- The user may send photos of a medicine label or a lab report. Read them carefully. For a medicine, say what it is, how to take it and any warning that matters for this user. For a lab report, list each test with value, unit and reference range, then explain what stands out.

Actions in the app
- You can propose actions with the tools. Each proposal appears as a button the user must press, so it is safe to propose, but only propose what clearly helps (for example after reading a lab report, propose adding each result; after the user says they took a medicine that is in their list, propose logging it). Never claim an action was done; say you've added a button for it.`;

// Tool proposals become confirm buttons in the app; nothing runs without the user's tap.
const TOOLS = [
  { name: "log_dose", strict: true,
    description: "Propose logging that the user just took one dose of a medicine that is already in their medicine list. Use the exact key shown in the user data.",
    input_schema: { type: "object", additionalProperties: false, required: ["drug_key"],
      properties: { drug_key: { type: "string", description: "Medicine key from the user's list, e.g. paracetamol" } } } },
  { name: "add_medicine", strict: true,
    description: "Propose adding a medicine to the user's medicine list. drug_key must be one of the known keys listed in the user data.",
    input_schema: { type: "object", additionalProperties: false, required: ["drug_key", "dose", "times_per_day"],
      properties: { drug_key: { type: "string" }, dose: { type: "number", description: "Amount per dose in the medicine's unit" }, times_per_day: { type: "integer" } } } },
  { name: "add_blood_result", strict: true,
    description: "Propose saving one lab result (for example read from a lab report photo). Use empty strings for a missing reference limit or date.",
    input_schema: { type: "object", additionalProperties: false, required: ["name", "value", "unit", "ref_min", "ref_max", "date"],
      properties: { name: { type: "string" }, value: { type: "number" }, unit: { type: "string" },
        ref_min: { type: "string", description: "Lower reference limit as a number, or empty" },
        ref_max: { type: "string", description: "Upper reference limit as a number, or empty" },
        date: { type: "string", description: "Test date YYYY-MM-DD, or empty" } } } },
  { name: "open_page", strict: true,
    description: "Propose opening a page of the app.",
    input_schema: { type: "object", additionalProperties: false, required: ["page"],
      properties: { page: { type: "string", enum: ["home", "twin", "pulse", "blood", "lab", "meds", "train", "profile"] } } } }
];

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function toMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error("messages required");
  const msgs = raw.slice(-20).map(m => {
    const role = m.role === "assistant" ? "assistant" : "user";
    const text = String(m.text || "").slice(0, 4000);
    const images = role === "user" && Array.isArray(m.images) ? m.images.slice(0, 3) : [];
    const content = [];
    for (const img of images) {
      if (!IMAGE_TYPES.has(img.media_type) || typeof img.data !== "string" || img.data.length > 7_000_000) throw new Error("bad image");
      content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
    }
    content.push({ type: "text", text: text || (images.length ? "ช่วยอ่านรูปนี้ให้หน่อย" : "...") });
    return { role, content };
  });
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs.at(-1).role !== "user") throw new Error("last message must be from the user");
  return msgs;
}

export default async (req) => {
  // GET: lets the app hide the assistant when no API key is set yet
  if (req.method === "GET") return json(200, { ready: !!process.env.ANTHROPIC_API_KEY });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  // 1. Who is asking?
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let uid;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID });
    uid = payload.sub;
  } catch { return json(401, { error: "sign in required" }); }

  // 2. Daily quota per user
  const day = new Date().toISOString().slice(0, 10);
  const store = getStore("chat-quota");
  const key = `${uid}/${day}`;
  const used = Number(await store.get(key)) || 0;
  if (used >= DAILY_LIMIT) return json(429, { error: `วันนี้ใช้ครบ ${DAILY_LIMIT} ข้อความแล้ว พรุ่งนี้ใช้ได้ใหม่` });
  await store.set(key, String(used + 1));

  // 3. Build the request
  let body, messages;
  try { body = await req.json(); messages = toMessages(body.messages); }
  catch (e) { return json(400, { error: e.message }); }
  const context = String(body.context || "").slice(0, 12000);
  const system = [
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },   // stable prefix, cached
    { type: "text", text: "ข้อมูลผู้ใช้ (จากแอป ณ ตอนนี้):\n" + (context || "ยังไม่มีข้อมูล") }
  ];

  // 4. Stream Claude's reply; proposals from tools are forwarded as actions
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = obj => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        for (let round = 0; round < 3; round++) {
          const s = client.beta.messages.stream({
            model: MODEL,
            max_tokens: 4096,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",                     // if a safety classifier declines, Anthropic retries on its recommended model
            output_config: { effort: "low" },          // chat: fast replies
            system, tools: TOOLS, messages
          });
          for await (const ev of s) {
            if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") send({ type: "text", text: ev.delta.text });
          }
          const msg = await s.finalMessage();
          if (msg.stop_reason === "refusal") { send({ type: "notice", text: "ผู้ช่วยตอบคำถามนี้ไม่ได้ ลองถามใหม่อีกแบบ หรือปรึกษาแพทย์/เภสัชกร" }); break; }
          const calls = msg.content.filter(b => b.type === "tool_use");
          if (msg.stop_reason !== "tool_use" || !calls.length) break;
          for (const c of calls) send({ type: "action", name: c.name, input: c.input });
          messages = [...messages,
            { role: "assistant", content: msg.content },
            { role: "user", content: calls.map(c => ({ type: "tool_result", tool_use_id: c.id, content: "แสดงเป็นปุ่มให้ผู้ใช้กดยืนยันแล้ว ยังไม่ได้ทำจนกว่าผู้ใช้จะกด" })) }];
        }
      } catch (err) {
        const status = err instanceof Anthropic.APIError ? err.status : 0;
        send({ type: "error", text: status === 429 ? "ระบบ AI ใช้งานหนาแน่น ลองใหม่อีกสักครู่" : "ตอนนี้เชื่อมต่อ AI ไม่สำเร็จ ลองใหม่อีกครั้ง" });
        console.error("chat error", status, err?.message);
      }
      send({ type: "done" });
      controller.close();
    }
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
};

export const config = { path: "/api/chat" };

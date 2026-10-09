import { AppError } from "@/lib/domain/models";
import { runtime, one, run, consumeLimit } from "./store";
const enc = new TextEncoder();
function b64(a: Uint8Array) {
  let s = "";
  for (let i = 0; i < a.length; i += 8192)
    s += String.fromCharCode(...a.subarray(i, i + 8192));
  return btoa(s);
}
function unb64(s: string) {
  return Uint8Array.from(atob(s), (x) => x.charCodeAt(0));
}
async function encryptionKey() {
  const secret = runtime().SETTINGS_SECRET;
  if (!secret) throw new AppError(503, "Secure settings are not configured.");
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", enc.encode(secret)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function saveKey(key: string) {
  if (!/^AIza[\w-]{20,}$/.test(key))
    throw new AppError(400, "Enter a valid Google AI Studio API key.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    enc.encode(key),
  );
  await run(
    "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    "gemini_key",
    b64(iv) + "." + b64(new Uint8Array(data)),
  );
}
export async function keyConfigured() {
  return !!(await one("SELECT key FROM settings WHERE key=?", "gemini_key"));
}
async function apiKey() {
  const row = await one("SELECT value FROM settings WHERE key=?", "gemini_key");
  if (!row)
    throw new AppError(
      503,
      "The owner needs to connect a Gemini key in Settings before AI processing can begin.",
      "key_missing",
    );
  const [iv, data] = row.value.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv) },
      await encryptionKey(),
      unb64(data),
    ),
  );
}
export const chatModel = () =>
  runtime().GEMINI_CHAT_MODEL || "gemini-2.5-flash";
export const embedModel = () =>
  runtime().EMBEDDING_MODEL || "gemini-embedding-001";
async function call(path: string, body: any, uid: string) {
  const key = await apiKey();
  await consumeLimit("ai:global", 150, 86400000);
  await consumeLimit("ai:user:" + uid, 100, 86400000);
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/" + path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!response.ok) {
    if (response.status === 429)
      throw new AppError(
        429,
        "Gemini quota reached. Progress is saved. Retry after your free quota resets.",
        "provider_quota",
      );
    if (response.status === 404)
      throw new AppError(
        502,
        "The configured Gemini model is unavailable for this key. The owner can check model access in Google AI Studio.",
        "model_unavailable",
      );
    if (response.status === 400 || response.status === 403)
      throw new AppError(
        502,
        "Gemini rejected the request. Check the API key and model access in Settings.",
        "provider_rejected",
      );
    throw new AppError(
      502,
      "Gemini is unavailable. Your progress is saved. Please retry.",
      "provider_unavailable",
    );
  }
  return response.json() as Promise<any>;
}
export async function generate(
  system: string,
  text: string,
  uid: string,
  pdf?: Uint8Array,
) {
  if (text.length > 26000)
    throw new AppError(413, "This extraction batch is too large.");
  const parts: any[] = [{ text }];
  if (pdf)
    parts.push({ inlineData: { mimeType: "application/pdf", data: b64(pdf) } });
  const data = await call(
    "models/" + chatModel() + ":generateContent",
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        maxOutputTokens: 16000,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    uid,
  );
  const c = data.candidates?.[0];
  if (!c || c.finishReason !== "STOP")
    throw new AppError(
      502,
      "Gemini returned an incomplete or blocked response. Retry this batch.",
      "incomplete_output",
    );
  try {
    return JSON.parse(
      c.content.parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join(""),
    );
  } catch {
    throw new AppError(
      502,
      "Gemini returned malformed output. Retry this batch.",
      "invalid_output",
    );
  }
}
export async function embed(
  texts: string[],
  uid: string,
  query = false,
): Promise<number[][]> {
  const model = embedModel();
  const data = await call(
    "models/" + model + ":batchEmbedContents",
    {
      requests: texts.map((text) => ({
        model: "models/" + model,
        content: { parts: [{ text: text.slice(0, 5000) }] },
        taskType: query ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      })),
    },
    uid,
  );
  const vectors = data.embeddings?.map((e: any) => e.values);
  if (
    !vectors ||
    vectors.length !== texts.length ||
    vectors.some(
      (v: any) =>
        !Array.isArray(v) ||
        v.length !== 768 ||
        v.some((n: any) => typeof n !== "number" || !Number.isFinite(n)),
    )
  )
    throw new AppError(502, "Gemini returned invalid embeddings.");
  return vectors.map((v: number[]) => {
    const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    return v.map((x) => (n ? x / n : x));
  });
}

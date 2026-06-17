const Groq = require("groq-sdk");
const apiKey = process.env.GROQ_API_KEY;

let groq;
if (apiKey) {
  groq = new Groq({ apiKey });
}

// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const BATCH_SIZE = 5;                 // hard rule, now actually enforced below
const MIN_MS_BETWEEN_CALLS = 2100;    // verify current rate limit in Groq console — this varies by tier/model
const MAX_API_RETRIES = 2;            // for 429 / 5xx / network errors
const RETRY_BASE_DELAY_MS = 1000;
const MAX_PARSE_RETRIES = 1;          // for "model returned non-JSON" cases

const VALID_SENTIMENT = ["Positive", "Negative", "Neutral", "Mixed"];
const VALID_DEPT = ["Front Office", "Housekeeping", "Maintenance", "Food & Beverage", "Spa", "Management", "Facilities"];
const VALID_URGENCY = ["High", "Medium", "Low"];
const VALID_EMOTION = ["Angry", "Frustrated", "Disappointed", "Neutral", "Satisfied", "Delighted", "Concerned", "Anxious"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════
// THROTTLE — enforced here, not just documented
// ═══════════════════════════════════════════
let lastCallAt = 0;
async function throttle() {
  const wait = MIN_MS_BETWEEN_CALLS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function callGroqWithRetry(params, attempt = 0) {
  await throttle();
  try {
    return await groq.chat.completions.create(params);
  } catch (err) {
    const status = err?.status || err?.response?.status;
    const retriable = status === 429 || (status >= 500 && status < 600) || err.code === "ECONNRESET";
    if (retriable && attempt < MAX_API_RETRIES) {
      await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
      return callGroqWithRetry(params, attempt + 1);
    }
    throw err;
  }
}

// ═══════════════════════════════════════════
// INPUT SANITIZATION
// ═══════════════════════════════════════════
function sanitizeText(text, maxLen = 2000) {
  if (!text) return "";
  return String(text)
    .replace(/[\u0000-\u001F\u007F]/g, " ") // strip control chars that can break formatting
    .trim()
    .slice(0, maxLen);
}

function sanitizeReview(r) {
  return {
    review_text: sanitizeText(r.review_text),
    rating: typeof r.rating === "number" ? r.rating : (Number(r.rating) || null),
    platform: r.platform || "Unknown"
  };
}

// ═══════════════════════════════════════════
// OUTPUT VALIDATION — never let a bad/missing field crash the pipeline
// ═══════════════════════════════════════════
function fallbackResult(index, reason) {
  return {
    index,
    sentiment: "Neutral",
    sentiment_reason: "Automated analysis failed; flagged for manual review.",
    confidence: 0,
    primary_department: "Management",
    urgency: "Medium",
    urgency_reason: reason || "Could not be auto-classified.",
    guest_emotion: "Neutral",
    issues: [],
    positive_aspects: [],
    is_suspicious: false,
    escalation_risk: false,
    needs_human_review: true,
    staff_mentions: [],
    _autoFallback: true
  };
}

function validateAndCoerce(item, expectedIndex) {
  if (!item || typeof item !== "object") return fallbackResult(expectedIndex, "Malformed item from model.");

  const out = { ...item, index: expectedIndex };
  if (!VALID_SENTIMENT.includes(out.sentiment)) out.sentiment = "Neutral";
  if (!VALID_DEPT.includes(out.primary_department)) out.primary_department = "Management";
  if (!VALID_URGENCY.includes(out.urgency)) out.urgency = "Medium";
  if (!VALID_EMOTION.includes(out.guest_emotion)) out.guest_emotion = "Neutral";
  out.confidence = typeof item.confidence === "number" ? Math.max(0, Math.min(100, item.confidence)) : 0;
  out.issues = Array.isArray(item.issues) ? item.issues : [];
  out.positive_aspects = Array.isArray(item.positive_aspects) ? item.positive_aspects : [];
  out.staff_mentions = Array.isArray(item.staff_mentions) ? item.staff_mentions : [];
  out.is_suspicious = !!item.is_suspicious;
  out.escalation_risk = !!item.escalation_risk;
  // Safety net: low-confidence items always get routed to a human regardless of what the model flagged
  out.needs_human_review = item.needs_human_review === true || out.confidence < 40;
  return out;
}

// ═══════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `You are a senior hotel operations analyst. You convert guest reviews into structured operational data. Be precise; do not infer facts the review doesn't state.

Department glossary (pick the ONE department most responsible for the main point of the review):
- Front Office: check-in/out, reservations, billing, reception staff
- Housekeeping: room cleanliness, linens, in-room amenities
- Maintenance: AC/heating, plumbing, electrical, broken fixtures
- Food & Beverage: restaurant, room service, breakfast, bar
- Spa: spa/wellness services
- Management: policy, refunds, overall experience, or complaints spanning multiple departments
- Facilities: pool, gym, parking, building/grounds

Confidence calibration: use 90-100 only when the review is unambiguous. Use 50-70 for mixed/vague reviews. Use under 40 when you are genuinely unsure.

is_suspicious is true ONLY when the review text and star rating clearly contradict each other.
Example -> rating: 5, text: "Room was dirty, AC didn't work, staff was rude." => is_suspicious: true.
Example -> rating: 5, text: "Great stay, will come back!" => is_suspicious: false (short/generic positive text with a high rating is normal, not suspicious).

Return ONLY a valid JSON array of objects, one per review, in input order. No explanation, no markdown, no text outside the array.`;

function buildUserPrompt(reviews) {
  const N = reviews.length;
  return `Analyze these ${N} hotel reviews. Return a JSON array with exactly ${N} objects in the same order.

Each object must have:
{
  "index": number (0-based, matches input order),
  "sentiment": "Positive" | "Negative" | "Neutral" | "Mixed",
  "sentiment_reason": "Brief explanation of why this sentiment was assigned",
  "confidence": number 0-100,
  "primary_department": one of ["Front Office", "Housekeeping", "Maintenance", "Food & Beverage", "Spa", "Management", "Facilities"],
  "urgency": "High" | "Medium" | "Low",
  "urgency_reason": "Brief explanation of why this urgency level",
  "guest_emotion": "Angry" | "Frustrated" | "Disappointed" | "Neutral" | "Satisfied" | "Delighted" | "Concerned" | "Anxious",
  "issues": [ONLY complaints explicitly stated in the review text — do NOT invent or assume. Empty array if none mentioned],
  "positive_aspects": [ONLY positives explicitly stated in the review text — do NOT invent or assume. Empty array if the guest did not specifically praise anything],
  "is_suspicious": boolean,
  "escalation_risk": boolean (true if review indicates potential legal action, media threat, or severe safety issue),
  "needs_human_review": boolean,
  "staff_mentions": [array of staff names mentioned in the review, empty if none]
}

Reviews:
${reviews.map((r, i) => `[${i}] Platform: ${r.platform} | Rating: ${r.rating ?? "Unknown"}/5\n"${r.review_text}"`).join("\n\n")}`;
}

function parseModelJson(raw) {
  const cleanText = raw.replace(/```json|```/g, "").trim();
  let parsed = JSON.parse(cleanText); // throws if invalid — caller handles

  if (!Array.isArray(parsed)) {
    const arrKey = Object.keys(parsed).find((k) => Array.isArray(parsed[k]));
    if (arrKey) {
      parsed = parsed[arrKey];
    } else if (Object.values(parsed).every((v) => v && typeof v === "object" && "index" in v)) {
      parsed = Object.values(parsed);
    }
  }
  return parsed;
}

// ═══════════════════════════════════════════
// CORE: one API call for up to BATCH_SIZE reviews
// ═══════════════════════════════════════════
async function analyseSingleBatch(reviews, attempt = 0) {
  const N = reviews.length;
  const maxTokens = 350 + N * 260; // headroom per review so verbose JSON doesn't get truncated

  let raw;
  try {
    const completion = await callGroqWithRetry({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(reviews) }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" }
    });
    raw = completion.choices[0].message.content;
  } catch (err) {
    console.error("[Batch] Groq API error:", err.message || err);
    return reviews.map((_, i) => fallbackResult(i, "API call failed."));
  }

  let parsed;
  try {
    parsed = parseModelJson(raw);
  } catch (err) {
    console.error("[Batch] JSON parse failed:", err.message, "| raw (truncated):", raw?.slice(0, 300));
    if (attempt < MAX_PARSE_RETRIES) {
      return analyseSingleBatch(reviews, attempt + 1);
    }
    return reviews.map((_, i) => fallbackResult(i, "Model returned invalid JSON after retry."));
  }

  if (!Array.isArray(parsed)) {
    console.error("[Batch] Response is not an array after unwrap attempts:", raw?.slice(0, 300));
    return reviews.map((_, i) => fallbackResult(i, "Unexpected response shape."));
  }

  // Reconcile by index so a single missing/extra item doesn't shift everything else
  const byIndex = new Map();
  parsed.forEach((item, i) => {
    const idx = Number.isInteger(item?.index) ? item.index : i;
    byIndex.set(idx, validateAndCoerce(item, idx));
  });

  const results = [];
  for (let i = 0; i < N; i++) {
    results.push(byIndex.get(i) || fallbackResult(i, "Missing from model response."));
  }
  return results;
}

// ═══════════════════════════════════════════
// PUBLIC: chunks any input into BATCH_SIZE pieces automatically
// ═══════════════════════════════════════════
exports.analyseBatch = async function analyseBatch(reviews) {
  if (!groq || !reviews || reviews.length === 0) return [];

  const sanitized = reviews.map(sanitizeReview);

  if (sanitized.length <= BATCH_SIZE) {
    return analyseSingleBatch(sanitized);
  }

  const allResults = [];
  for (let i = 0; i < sanitized.length; i += BATCH_SIZE) {
    const chunk = sanitized.slice(i, i + BATCH_SIZE);
    const chunkResults = await analyseSingleBatch(chunk);
    allResults.push(...chunkResults);
  }
  // re-sequence indices to be global across all chunks
  return allResults.map((r, i) => ({ ...r, index: i }));
};

// Legacy single-review analysis (kept for backward compatibility)
exports.analyseReview = async (text, rating) => {
  const results = await exports.analyseBatch([{ review_text: text, rating, platform: "Unknown" }]);
  return results.length > 0 ? results[0] : null;
};

// ═══════════════════════════════════════════
// TASK 2 — DRAFT GENERATION (on-demand, GM triggered)
// ═══════════════════════════════════════════
exports.generateReply = async (text, tone = "Formal") => {
  if (!groq) return "Thank you for your feedback.";

  const safeText = sanitizeText(text, 3000);
  const prompt = `Write a ${tone} response (3-5 sentences) to this hotel guest review. Only reference facts actually mentioned in the review — do not invent details.
Return JSON only: { "reply": "..." }

Review: "${safeText}"`;

  try {
    const completion = await callGroqWithRetry({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.4,
      max_tokens: 500,
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    if (typeof parsed.reply === "string" && parsed.reply.trim()) {
      return parsed.reply.trim();
    }
    throw new Error("Empty or missing 'reply' field");
  } catch (err) {
    console.error("[Reply] Groq error:", err.message || err);
    return "Thank you for your feedback. We will look into this.";
  }
};
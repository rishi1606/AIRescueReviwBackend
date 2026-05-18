const Groq = require("groq-sdk");
const apiKey = process.env.GROQ_API_KEY;

let groq;
if (apiKey) {
  groq = new Groq({ apiKey });
}

// ═══════════════════════════════════════════
// TASK 1 — BATCH SENTIMENT ANALYSIS
// Model  : llama-3.1-8b-instant (8B, fast, cheap)
// Temp   : 0.1 (consistent JSON)
// Batch  : 5 reviews per call (hard rule)
// Delay  : 2000ms between batches (Groq rate limit: 30 req/min)
// ═══════════════════════════════════════════

exports.analyseBatch = async (reviews) => {
  if (!groq || !reviews || reviews.length === 0) return [];

  const N = reviews.length;

  const systemPrompt = `You are a hotel review analyst. You will receive multiple hotel reviews. Return ONLY a valid JSON array. No explanation. No markdown. No extra text. Just the raw JSON array.`;

  const userPrompt = `Analyze these ${N} hotel reviews.
Return a JSON array with exactly ${N} objects in the same order.

Each object must have:
{
  "index": number (0-based, matches input order),
  "sentiment": "Positive" | "Negative" | "Neutral" | "Mixed",
  "confidence": number 0-100,
  "primary_department": one of ["Front Office", "Housekeeping", "Maintenance", "Food & Beverage", "Spa", "Management", "Facilities"],
  "urgency": "High" | "Medium" | "Low",
  "issues": [array of specific issue strings, empty if none],
  "positive_aspects": [array of specific positive strings, empty if none],
  "needs_human_review": boolean
}

Reviews:
${reviews.map((r, i) => `[${i}] Platform: ${r.platform || "Unknown"} | Rating: ${r.rating}/5\n"${r.review_text}"`).join('\n\n')}`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });

    const raw = chatCompletion.choices[0].message.content;

    // Parse: strip markdown backticks if any
    let cleanText = raw.replace(/```json|```/g, "").trim();
    let parsed = JSON.parse(cleanText);

    // Groq json_object mode wraps arrays in an object sometimes
    if (!Array.isArray(parsed)) {
      // Try to find the array inside the object
      let foundArray = false;
      const keys = Object.keys(parsed);
      for (const key of keys) {
        if (Array.isArray(parsed[key])) {
          parsed = parsed[key];
          foundArray = true;
          break;
        }
      }
      
      // If it returned an object with numeric keys like { "0": {...}, "1": {...} }
      if (!foundArray && Object.values(parsed).every(val => typeof val === 'object' && val !== null && 'index' in val)) {
        parsed = Object.values(parsed);
      }
    }

    if (!Array.isArray(parsed)) {
      console.error("[Batch] Response is not an array:", raw);
      return [];
    }

    return parsed;
  } catch (err) {
    console.error("[Batch] Groq Sentiment Error:", err.message || err);
    return [];
  }
};

// Legacy single-review analysis (kept for backward compatibility)
exports.analyseReview = async (text, rating) => {
  const results = await exports.analyseBatch([{ review_text: text, rating, platform: "Unknown" }]);
  if (results.length > 0) {
    return results[0];
  }
  return null;
};

// ═══════════════════════════════════════════
// TASK 2 — DRAFT GENERATION (on-demand, GM triggered)
// Model  : llama-3.3-70b-versatile (70B, high quality)
// Temp   : 0.4 (natural language)
// ═══════════════════════════════════════════

exports.generateReply = async (text, tone = "Formal") => {
  try {
    const prompt = `
      Write a ${tone} response to this hotel review: "${text}".
      Return JSON: { "reply": "..." }
    `;

    if (!groq) return "Thank you for your feedback.";

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.4,
      max_tokens: 500,
      response_format: { type: "json_object" }
    });

    return JSON.parse(chatCompletion.choices[0].message.content).reply;
  } catch (err) {
    return "Thank you for your feedback. We will look into this.";
  }
};

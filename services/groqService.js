const Groq = require("groq-sdk");
const apiKey = process.env.GROQ_API_KEY;

let groq;
if (apiKey) {
  groq = new Groq({ apiKey });
}

exports.analyseReview = async (text, rating) => {
  try {
    const prompt = `
      Analyse the following hotel guest review and return a JSON object.
      Review: "${text}"
      Rating: ${rating}/5

      Requirements:
      1. sentiment: "Positive", "Negative", "Neutral", or "Mixed"
      2. confidence: Calculate a score from 0-100
      3. primary_department: Pick one: ["Front Office", "Housekeeping", "Maintenance", "Food & Beverage", "Spa", "Management", "Facilities"]
      4. urgency: "High", "Medium", or "Low"
      5. issues: array of strings
      6. positive_aspects: array of strings
      7. suggested_reply: A draft reply
      8. needs_human_review: boolean

      Format: JSON only.
    `;

    if (!groq) return null;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    return JSON.parse(chatCompletion.choices[0].message.content);
  } catch (err) {
    console.error("Groq AI Error:", err);
    return null;
  }
};

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
      response_format: { type: "json_object" }
    });

    return JSON.parse(chatCompletion.choices[0].message.content).reply;
  } catch (err) {
    return "Thank you for your feedback. We will look into this.";
  }
};

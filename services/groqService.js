const Groq = require("groq-sdk");
const apiKey = process.env.GROQ_API_KEY;

let groq;
if (apiKey) {
  groq = new Groq({ apiKey });
} else {
  console.warn("WARNING: GROQ_API_KEY is missing. AI features will be disabled.");
}

exports.analyseReview = async (text, rating) => {
  try {
    const prompt = `
      Analyse the following hotel guest review and return a JSON object.
      Review: "${text}"
      Rating: ${rating}/5

      Requirements:
      1. sentiment: "Positive", "Negative", "Neutral", or "Mixed"
      
      2. confidence_breakdown: Calculate 0-100 scores for these 4 areas (25% weight each):
         - sentiment_clarity: Language clarity, lack of sarcasm/mixed signals.
         - dept_detection: How clearly it maps to one specific department.
         - response_quality: How relevant a potential response would be to this context.
         - data_completeness: Length of text and presence of rating.
      
      3. confidence: The final weighted average of the above 4 scores.
      
      4. primary_department: "Front Office", "Housekeeping", "Maintenance", "F&B", "Security", or "Management"
      5. urgency: "High", "Medium", or "Low"
      6. issues: array of specific issue strings (e.g. ["cold food", "noisy room"]) - PLAIN TEXT ONLY, NO OBJECTS
      7. positive_aspects: array of positive points (e.g. ["friendly staff", "clean pool"]) - PLAIN TEXT ONLY, NO OBJECTS
      8. suggested_reply: A draft reply to the guest
      9. needs_human_review: Set to true if final confidence < 75 or sentiment is highly complex.

      Format: JSON only.
    `;

    if (!groq) return null;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama3-70b-8192",
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(chatCompletion.choices[0].message.content);
    
    // Ensure numeric confidence for safety
    if (result.confidence_breakdown) {
      const b = result.confidence_breakdown;
      result.confidence = Math.round(
        (b.sentiment_clarity || 0) * 0.25 + 
        (b.dept_detection || 0) * 0.25 + 
        (b.response_quality || 0) * 0.25 + 
        (b.data_completeness || 0) * 0.25
      );
    }

    return result;
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
      model: "llama3-70b-8192",
      response_format: { type: "json_object" }
    });

    return JSON.parse(chatCompletion.choices[0].message.content).reply;
  } catch (err) {
    return "Thank you for your feedback. We will look into this.";
  }
};

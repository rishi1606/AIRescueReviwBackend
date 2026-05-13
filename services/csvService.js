const fs = require("fs");
const csv = require("csv-parser");
const Review = require("../models/Review");
const ImportBatch = require("../models/ImportBatch");
const groqService = require("./groqService");
const ticketService = require("./ticketService");

exports.processCsvFile = async (filePath, originalName, hotelId) => {
  const batch = new ImportBatch({
    hotelId,
    filename: originalName,
    status: "Processing"
  });
  await batch.save();

  // Process in background
  this.runCsvAnalysis(filePath, batch._id, hotelId);

  return batch;
};

exports.runCsvAnalysis = async (filePath, batchId, hotelId) => {
  const reviews = [];
  const results = {
    validCount: 0,
    duplicateCount: 0,
    errorCount: 0,
    errors: []
  };

  fs.createReadStream(filePath)
    .pipe(csv())
    .on("data", (data) => reviews.push(data))
    .on("end", async () => {
      try {
        const batch = await ImportBatch.findById(batchId);
        batch.totalCount = reviews.length;

        const processedReviews = [];
        for (const row of reviews) {
          try {
            // Basic validation
            if (!row.review_text || !row.rating) {
              results.errorCount++;
              results.errors.push(`Row missing text/rating: ${JSON.stringify(row)}`);
              continue;
            }

            // Deduplication (simple check by review_id if provided)
            if (row.review_id) {
              const existing = await Review.findOne({ review_id: row.review_id, hotel_id: hotelId });
              if (existing) {
                results.duplicateCount++;
                continue;
              }
            }

            const review = new Review({
              hotel_id: hotelId,
              review_id: row.review_id || `CSV-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              guest_name: row.reviewer_name || "Anonymous",
              review_date: row.review_date || new Date().toISOString(),
              rating: parseInt(row.rating),
              review_text: row.review_text,
              platform: row.platform || "Import",
              status: "Pending AI",
              is_manual: false
            });

            await review.save();
            processedReviews.push(review);
            results.validCount++;
          } catch (err) {
            results.errorCount++;
            results.errors.push(`Processing error: ${err.message}`);
          }
        }

        batch.status = "Completed";
        batch.validCount = results.validCount;
        batch.duplicateCount = results.duplicateCount;
        batch.errorCount = results.errorCount;
        batch.errors = results.errors;
        batch.completedAt = new Date();
        await batch.save();

        // Start background AI analysis
        if (processedReviews.length > 0) {
          this.batchAnalyseReviews(processedReviews, hotelId);
        }
      } catch (err) {
        console.error("CSV analysis failed:", err);
      }
    });
};

exports.batchAnalyseReviews = async (reviews, hotelId) => {
  const Hotel = require("../models/Hotel");
  const hotel = await Hotel.findById(hotelId);
  const isAutoTicketOn = hotel?.aiConfig?.autoTicket;

  for (const review of reviews) {
    try {
      const aiResult = await groqService.analyseReview(review.review_text, review.rating);
      if (aiResult) {
        review.sentiment = aiResult.sentiment;
        review.confidence = aiResult.confidence;

        // Only assign department if autoTicket is ON
        if (isAutoTicketOn) {
          review.primary_department = aiResult.primary_department;
        } else {
          review.primary_department = null;
        }

        review.urgency = aiResult.urgency;
        
        // Robust sanitization: convert objects to strings if AI returns them
        const sanitizeArray = (arr) => {
          if (!Array.isArray(arr)) return [];
          return arr.map(item => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item !== null) {
              // Try to find a logical text field like 'issue', 'aspect', or 'description'
              return item.issue || item.aspect || item.description || item.text || JSON.stringify(item);
            }
            return String(item);
          });
        };

        review.issues = sanitizeArray(aiResult.issues);
        review.positive_aspects = sanitizeArray(aiResult.positive_aspects);
        review.departments = sanitizeArray(aiResult.departments);
        
        review.suggested_reply = aiResult.suggested_reply;
        review.needs_human_review = aiResult.needs_human_review;
        review.status = "AI Processed";
        await review.save();

        // Create ticket if urgency is high or issues found AND autoTicket is ON
        if (isAutoTicketOn && (review.urgency === "High" || review.urgency === "Medium")) {
          await ticketService.createTicketFromReview(review, hotelId);
        }
      }
    } catch (err) {
      console.error(`AI analysis failed for review ${review._id}:`, err);
    }
  }
};

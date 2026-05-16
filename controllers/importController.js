const Review = require("../models/Review");
const Ticket = require("../models/Ticket");
const ImportBatch = require("../models/ImportBatch");
const csvService = require("../services/csvService");
const scraperService = require("../services/scraperService");
const fs = require("fs");

exports.scrapeGoogleReviews = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required'
      });
    }

    const result = await scraperService.openGoogleMaps(url);

    return res.json(result);

  } catch (err) {
    console.error('[Controller Error]', err);

    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

exports.scrapeBookingReviews = async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: "URL is required" });
    }

    console.log(`[Controller] Step 1: Opening browser for Booking: ${url}`);
    const result = await scraperService.openBookingReviews(url);

    res.json(result);

  } catch (err) {
    console.error("[Controller] Step 1 Error (Booking):", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.scrapeExpediaReviews = async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: "URL is required" });
    }

    console.log(`[Controller] Opening browser for Expedia: ${url}`);
    const result = await scraperService.openExpediaReviews(url);

    res.json(result);

  } catch (err) {
    console.error("[Controller] Error (Expedia):", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.scrapeAgodaReviews = async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: "URL is required" });
    }

    console.log(`[Controller] Opening browser for Agoda: ${url}`);
    const result = await scraperService.openAgodaReviews(url);

    res.json(result);

  } catch (err) {
    console.error("[Controller] Error (Agoda):", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.scrapeHotelsReviews = async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: "URL is required" });
    }

    console.log(`[Controller] Opening browser for Hotels.com: ${url}`);
    const result = await scraperService.openHotelsReviews(url);

    res.json(result);

  } catch (err) {
    console.error("[Controller] Error (Hotels.com):", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.scrapeAirbnbReviews = async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: "URL is required" });
    }

    console.log(`[Controller] Opening browser for Airbnb: ${url}`);
    const result = await scraperService.openAirbnbReviews(url);

    res.json(result);

  } catch (err) {
    console.error("[Controller] Error (Airbnb):", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.uploadCsv = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    const hotelId = req.user.hotel_id;
    const results = [];

    for (const file of req.files) {
      const batch = await csvService.processCsvFile(file.path, file.originalname, hotelId);
      results.push(batch);
      // Clean up uploaded file
      fs.unlinkSync(file.path);
    }

    res.json({
      success: true,
      message: "CSV files uploaded and processing started in background",
      batches: results
    });
  } catch (err) {
    next(err);
  }
};

exports.getImportHistory = async (req, res, next) => {
  try {
    const history = await ImportBatch.find({ hotelId: req.user.hotel_id }).sort({ createdAt: -1 });
    res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
};

exports.clearAllData = async (req, res, next) => {
  try {
    const hotelId = req.user.hotel_id;
    await Promise.all([
      Review.deleteMany({ hotel_id: hotelId }),
      Ticket.deleteMany({ hotel_id: hotelId }),
      ImportBatch.deleteMany({ hotelId: hotelId })
    ]);
    res.json({ success: true, message: "All hotel data cleared" });
  } catch (err) {
    next(err);
  }
};

exports.runFullAnalysis = async (req, res, next) => {
  try {
    const hotelId = req.user.hotel_id;
    const reviews = await Review.find({ hotel_id: hotelId });

    // Process in background
    csvService.batchAnalyseReviews(reviews, hotelId);

    res.json({ success: true, message: "Full AI analysis started in background" });
  } catch (err) {
    next(err);
  }
};

exports.getTemplate = (req, res) => {
  const csv = "review_id,reviewer_name,review_date,rating,review_text,platform,response_text,response_date\nREV001,John Doe,2024-05-10,4,\"Great stay!\",Google,,";
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=reviewrescue_template.csv');
  res.send(csv);
};

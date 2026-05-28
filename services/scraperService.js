const puppeteer = require('puppeteer');

/**
 * Utility function for duplicate filtering
 */
function removeDuplicateReviews(reviews) {
  const seen = new Set();

  return reviews.filter(review => {
    // Unique key using review text + reviewer
    const uniqueKey = `${review.reviewerName}_${review.reviewText}`;

    if (seen.has(uniqueKey)) {
      return false;
    }

    seen.add(uniqueKey);
    return true;
  });
}

/**
 * Helper to check if a review date is older than 3 months from today.
 */
function isOlderThan3Months(dateStr) {
  try {
    if (!dateStr || typeof dateStr !== 'string') {
      return false;
    }

    // CLEAN INPUT
    const clean = dateStr
      .trim()
      .toLowerCase()
      .replace(/^(reviewed|reviewed on|posted on|stayed in)\s*:?\s*/i, '')
      .replace(/\s+on\s+.*$/, '')
      .trim();

    if (!clean) {
      return false;
    }

    // DEBUG
    console.log('Original Date:', dateStr);
    console.log('Cleaned Date:', clean);

    // 3 MONTHS AGO DATE
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // =========================
    // VERY RECENT DATES
    // =========================
    if (
      /\b(hour|minute|second|today|yesterday|now)\b/.test(clean) ||
      /\b\d+\s+(hour|minute|second|day|week)s?\b/.test(clean) ||
      /\ba\s+(day|hour|minute|second|week|month)\b/.test(clean) ||
      /\bthis\s+(week|month)\b/.test(clean) ||
      /\blast\s+(week|month)\b/.test(clean) ||
      /\b[1-3]\s+months?\b/.test(clean)
    ) {
      return false;
    }

    // =========================
    // X MONTHS AGO
    // =========================
    if (clean.includes('month')) {
      const match = clean.match(/(\d+)\s+months?/);

      if (match) {
        return parseInt(match[1], 10) > 3;
      }

      return false;
    }

    // =========================
    // YEARS AGO
    // =========================
    if (clean.includes('year')) {
      return true;
    }

    // =========================
    // FORMAT:
    // march 2025
    // =========================
    const monthYearMatch = clean.match(
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})$/
    );

    if (monthYearMatch) {
      const parsed = new Date(
        `1 ${monthYearMatch[1]} ${monthYearMatch[2]}`
      );

      if (!isNaN(parsed)) {
        console.log('Parsed Month-Year:', parsed);
        return parsed < threeMonthsAgo;
      }
    }

    // =========================
    // FORMAT:
    // 15 may 2026
    // =========================
    const dmyMatch = clean.match(
      /^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})$/
    );

    if (dmyMatch) {
      const parsed = new Date(
        `${dmyMatch[2]} ${dmyMatch[1]}, ${dmyMatch[3]}`
      );

      if (!isNaN(parsed)) {
        console.log('Parsed DMY:', parsed);
        return parsed < threeMonthsAgo;
      }
    }

    // =========================
    // FORMAT:
    // may 15, 2026
    // =========================
    const mdyMatch = clean.match(
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}$/
    );

    if (mdyMatch) {
      const parsed = new Date(clean);

      if (!isNaN(parsed)) {
        console.log('Parsed MDY:', parsed);
        return parsed < threeMonthsAgo;
      }
    }

    // =========================
    // FALLBACK PARSE
    // =========================
    const fallbackParsed = new Date(clean);

    if (!isNaN(fallbackParsed)) {
      console.log('Fallback Parsed:', fallbackParsed);
      return fallbackParsed < threeMonthsAgo;
    }

    // =========================
    // UNKNOWN FORMAT
    // =========================
    console.warn(
      `[isOlderThan3Months] Could not parse date: "${dateStr}"`
    );

    // SAFEST OPTION:
    // treat unknown dates as RECENT
    return false;

  } catch (err) {
    console.error('Date Parsing Error:', err);
    return false;
  }
}

exports.openGoogleMaps = async (
  url,
  limit = 30,
  headless = true,
  existingKeys = [],
  minRating = 1,
  maxRating = 5
) => {
  console.log(`Launching browser (Headless: ${headless})...`);

  try {
    const browser = await puppeteer.launch({
      headless: true,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    console.log(`Opening URL: ${url}`);

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000
    });

    console.log("Website fully loaded");

    // STEP 1 — Click Reviews Tab
    await page.waitForSelector(
      'div[role="tab"][aria-label="Reviews"]',
      { timeout: 20000 }
    );

    await page.click('div[role="tab"][aria-label="Reviews"]');
    console.log("Reviews tab clicked");

    await page.waitForSelector(".Svr5cf.bKhjM", { timeout: 20000 });
    console.log("Reviews loaded");

    await new Promise(r => setTimeout(r, 3000));

    // STEP 2 — Sort by Most Recent
    let sortSuccess = false;

    try {
      console.log("Opening sort dropdown...");

      await page.waitForSelector(".MocG8c.o7IkCf.LMgvRb.KKjvXb", { timeout: 15000 });
      await page.click(".MocG8c.o7IkCf.LMgvRb.KKjvXb");

      console.log("Sort dropdown clicked");
      await new Promise(r => setTimeout(r, 2000));

      const clicked = await page.evaluate(() => {
        const options = Array.from(document.querySelectorAll('div[role="option"]'));
        for (const option of options) {
          const text = option.innerText?.trim()?.toLowerCase();
          if (text && text.includes("most recent")) {
            option.scrollIntoView({ block: "center" });
            option.click();
            return true;
          }
        }
        return false;
      });

      console.log("Most recent clicked:", clicked);

      if (clicked) {
        sortSuccess = true;
        console.log("Waiting for reviews to re-render after sort...");
        await new Promise(r => setTimeout(r, 8000));
        console.log("Sorted reviews loaded");
      }

    } catch (sortErr) {
      console.log("Sort failed:", sortErr.message);
    }

    if (!sortSuccess) {
      console.log("Most recent sort failed. Skipping scrape.");
      return { success: true, totalReviews: 0, reviews: [] };
    }

    // STEP 3 — Extraction Loop
    let scrollAttempts = 0;
    const maxScrollAttempts = 40;
    const existingSet = new Set(existingKeys || []);
    const finalReviewsMap = new Map();
    let noNewReviewLoads = 0;

    console.log(`Starting extraction (limit: ${limit})`);

    while (scrollAttempts < maxScrollAttempts) {
      console.log(`Scroll Attempt ${scrollAttempts + 1}`);

      // Click Read More buttons
      const readMoreButtons = await page.$$("span.Jmi7d.TJUuge");
      for (const btn of readMoreButtons) {
        try {
          const visible = await btn.evaluate(el => el.offsetWidth > 0 && el.offsetHeight > 0);
          if (visible) {
            await btn.click();
            await new Promise(r => setTimeout(r, 200));
          }
        } catch (e) { }
      }

      // Extract reviews
      const currentReviews = await page.$$eval(".Svr5cf.bKhjM", cards => {
        return cards.map(card => {

          // Reviewer name
          const reviewerName =
            card.querySelector("a.DHIhE.QB2Jof")?.innerText?.trim() ||
            card.querySelector('a[href*="maps/contrib"]')?.innerText?.trim() || "";

          // Rating
          const ratingText = card.querySelector(".GDWaad")?.innerText?.trim() || "";
          const rating = parseFloat(ratingText.split("/")[0]) || null;

          // Date — strip "on Google" suffix
          const rawDate = card.querySelector("span.iUtr1.CQYfx")?.innerText?.trim() || "";
          const reviewDate = rawDate.replace(/\s+on\s+.*$/i, "").trim();

          // Review text — from .K7oBsc span (confirmed from HTML)
          const reviewText =
            card.querySelector(".K7oBsc span")?.innerText?.trim() ||
            card.querySelector('div[jsname="NwoMSd"] span')?.innerText?.trim() ||
            card.querySelector('div[jsname="kmPxT"] span')?.innerText?.trim() ||
            card.querySelector(".wiI7pd")?.innerText?.trim() || "";

          // Stay type
          const stayType = card.querySelector(".ThUm5b span")?.innerText?.trim() || "";

          return { reviewerName, rating, reviewDate, stayType, reviewText };
        });
      });

      const deduplicated = removeDuplicateReviews(currentReviews);

      console.log("DEDUP DATES:", deduplicated.map(r => ({ name: r.reviewerName, date: r.reviewDate })));

      // Filter
      const filtered = deduplicated.filter(r => {
        if (!r.reviewerName) return false;
        const meetsRating = r.rating === null || (r.rating >= minRating && r.rating <= maxRating);
        const isNew = !existingSet.has(r.reviewerName + r.reviewDate + r.reviewText);
        const isNotOlder = !isOlderThan3Months(r.reviewDate);
        console.log(`[FILTER] ${r.reviewerName} | date: ${r.reviewDate} | older: ${!isNotOlder} | meetsRating: ${meetsRating} | isNew: ${isNew}`);
        return meetsRating && isNew && isNotOlder;
      });

      // Store in map
      let newlyAdded = 0;
      for (const review of filtered) {
        const key = review.reviewerName + review.reviewDate + review.reviewText;
        if (!finalReviewsMap.has(key)) {
          finalReviewsMap.set(key, review);
          newlyAdded++;
        }
      }

      const finalReviews = Array.from(finalReviewsMap.values());
      console.log(`Current visible: ${filtered.length} | Total collected: ${finalReviews.length} | Newly added: ${newlyAdded}`);

      // Stop if limit reached
      if (finalReviews.length >= limit) {
        console.log("Limit reached");
        break;
      }

      // Stop if no new reviews loading
      if (newlyAdded === 0) {
        noNewReviewLoads++;
      } else {
        noNewReviewLoads = 0;
      }

      if (noNewReviewLoads >= 3) {
        console.log("No new reviews loading. Stopping.");
        break;
      }

      // Stop if all reviews older than 3 months
      const realReviews = deduplicated.filter(r => r.reviewerName && r.reviewDate);
      const allOlder = realReviews.length > 0 && realReviews.every(r => isOlderThan3Months(r.reviewDate));
      if (allOlder) {
        console.log("All reviews older than 3 months. Stopping.");
        break;
      }

      // Scroll
      await page.hover('div[role="feed"]');
      await page.mouse.wheel({ deltaY: 3500 });
      console.log("Scrolled reviews");

      await new Promise(r => setTimeout(r, 5000));
      scrollAttempts++;
    }

    let finalReviews = Array.from(finalReviewsMap.values()).slice(0, limit);
    console.log(`Finished scraping ${finalReviews.length} reviews`);

    return {
      success: true,
      totalReviews: finalReviews.length,
      reviews: finalReviews
    };

  } catch (err) {
    console.error("Scraper Error:", err);
    throw err;
  }
};

exports.openBookingReviews = async (
  url,
  limit = 3,
  headless = false,
  existingKeys = [],
  minRating = 1,
  maxRating = 5
) => {

  console.log(`Launching browser for Booking (Headless: ${headless})...`);
  console.log(`LIMIT: ${limit}`);

  let finalMin = minRating;
  let finalMax = maxRating;

  // Convert 1-3 star filter correctly
  if (minRating === 1 && maxRating === 3) {
    finalMin = 0;
    finalMax = 3.9;
  }

  try {

    const browser = await puppeteer.launch({
      headless: true,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    console.log(`Opening Booking URL: ${url}`);

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('Booking page fully loaded');

    // =========================
    // CLICK REVIEW TAB
    // =========================

    try {

      await page.waitForSelector('#reviews-tab-trigger', {
        timeout: 10000
      });

      await page.$eval('#reviews-tab-trigger', el => {
        el.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      });

      await new Promise(r => setTimeout(r, 2000));

      await page.evaluate(() => {
        const btn = document.querySelector('#reviews-tab-trigger');
        if (btn) btn.click();
      });

      console.log('Reviews tab clicked');

    } catch (err) {
      console.log('⚠️ Reviews tab not found. Continuing...');
    }

    await new Promise(r => setTimeout(r, 8000));

    // =========================
    // WAIT FOR REVIEWS
    // =========================

    try {

      await page.waitForSelector('[data-testid="review-card"]', {
        timeout: 25000
      });

    } catch (err) {

      console.log('⚠️ No review cards found');

      await browser.close();

      return {
        success: false,
        message: 'No review cards found'
      };
    }

    // =========================
    // SORT NEWEST FIRST
    // =========================

    try {

      console.log('Sorting Booking reviews by NEWEST_FIRST');

      await page.waitForSelector(
        'select[name="reviewListSorters"]',
        { timeout: 10000 }
      );

      await page.evaluate(() => {

        const select = document.querySelector(
          'select[name="reviewListSorters"]'
        );

        if (select) {

          select.value = 'NEWEST_FIRST';

          select.dispatchEvent(
            new Event('change', { bubbles: true })
          );
        }

      });

      await new Promise(r => setTimeout(r, 7000));

      console.log('Successfully sorted by newest');

    } catch (err) {

      console.log('⚠️ Could not sort:', err.message);

      await browser.close();

      return {
        success: true,
        totalReviews: 0,
        reviews: []
      };
    }

    const existingSet = new Set(existingKeys || []);

    let allReviews = [];

    let currentPage = 1;

    // =========================
    // LOOP PAGES
    // =========================

    while (true) {

      console.log(`\n========= PAGE ${currentPage} =========`);

      // Scroll reviews section
      await page.evaluate(() => window.scrollBy(0, 2500));
      await new Promise(r => setTimeout(r, 2500));

      const currentReviews = await page.$$eval(
        '[data-testid="review-card"]',
        cards => {

          const unique = new Set();

          const results = [];

          for (const card of cards) {

            try {

              const reviewerName =
                card.querySelector('.b08850ce41')
                  ?.innerText
                  ?.trim() || '';

              const reviewDate =
                card.querySelector('[data-testid="review-date"]')
                  ?.innerText
                  ?.trim() || '';

              const reviewTitle =
                card.querySelector('[data-testid="review-title"]')
                  ?.innerText
                  ?.trim() || '';

              const positiveReview =
                card.querySelector('[data-testid="review-positive-text"] span')
                  ?.innerText
                  ?.trim() || '';

              const negativeReview =
                card.querySelector('[data-testid="review-negative-text"] span')
                  ?.innerText
                  ?.trim() || '';

              const ratingText =
                card.querySelector('.f63b14ab7a')
                  ?.innerText
                  ?.trim() || '';

              const rating = parseFloat(ratingText) || null;

              const reviewText = [
                reviewTitle,
                positiveReview,
                negativeReview
              ]
                .filter(Boolean)
                .join(' ');

              if (!reviewerName || !reviewText) {
                continue;
              }

              const key = reviewerName + reviewText;

              if (unique.has(key)) {
                continue;
              }

              unique.add(key);

              results.push({
                reviewerName,
                rating,
                reviewDate,
                reviewText
              });

            } catch (err) { }
          }

          return results;
        }
      );

      console.log(`Reviews found: ${currentReviews.length}`);

      if (!currentReviews.length) {
        console.log('No reviews on page');
        break;
      }

      // =========================
      // STOP IF ALL REVIEWS OLD
      // =========================

      const allOlder = currentReviews.every(r =>
        isOlderThan3Months(r.reviewDate)
      );

      if (allOlder) {

        console.log('All reviews older than 3 months');

        break;
      }

      // =========================
      // FILTER REVIEWS
      // =========================

      const newReviews = currentReviews.filter(r => {

        // Booking is out of 10 → convert to 5 scale
        let normRating = 5;

        if (r.rating !== null) {
          normRating = Math.round((r.rating / 2) * 10) / 10;
        }

        const meetsRating =
          normRating >= finalMin &&
          normRating <= finalMax;

        const isNew =
          !existingSet.has(
            r.reviewerName + r.reviewText
          );

        const isNotOlder =
          !isOlderThan3Months(r.reviewDate);

        return (
          meetsRating &&
          isNew &&
          isNotOlder
        );
      });

      console.log(`Filtered reviews: ${newReviews.length}`);

      // =========================
      // ADD REVIEWS
      // =========================

      allReviews.push(...newReviews);

      // Remove duplicates globally
      allReviews = allReviews.filter(
        (review, index, self) =>
          index === self.findIndex(r =>
            r.reviewerName === review.reviewerName &&
            r.reviewText === review.reviewText
          )
      );

      console.log(`Total collected: ${allReviews.length}`);

      // =========================
      // LIMIT REACHED
      // =========================

      if (allReviews.length >= limit) {

        console.log('Limit reached');

        break;
      }

      // =========================
      // PAGINATION
      // =========================

      currentPage++;

      console.log(`Trying page ${currentPage}`);

      for (let i = 0; i < 4; i++) {

        await page.evaluate(() =>
          window.scrollBy(0, window.innerHeight)
        );

        await new Promise(r => setTimeout(r, 1500));
      }

      await new Promise(r => setTimeout(r, 4000));

      const clicked = await page.evaluate((pageNo) => {

        const buttons = Array.from(
          document.querySelectorAll('li.d8842cf9f4 button')
        );

        const targetBtn = buttons.find(btn => {

          const aria =
            btn.getAttribute('aria-label')
              ?.trim();

          const text =
            btn.innerText
              ?.trim();

          return (
            aria === String(pageNo) ||
            text === String(pageNo)
          );
        });

        if (targetBtn) {

          targetBtn.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });

          targetBtn.click();

          return true;
        }

        return false;

      }, currentPage);

      console.log(`Page clicked: ${clicked}`);

      if (!clicked) {

        console.log('No more pages');

        break;
      }

      await new Promise(r => setTimeout(r, 8000));
    }

    // =========================
    // FINAL REVIEWS
    // =========================

    const reviews = allReviews.slice(0, limit);

    console.log('FINAL REVIEWS:', reviews.length);

    await browser.close();

    return {
      success: true,
      totalReviews: reviews.length,
      reviews
    };

  } catch (err) {

    console.error('Booking Scraper Error:', err);

    return {
      success: false,
      message: err.message
    };
  }
};

exports.scrapeBooking = async (url, maxReviews = 20) => {
  console.log(`[MockScraper] Simulating scrape for: ${url}`);

  await new Promise(r => setTimeout(r, 2000));

  const mockReviews = [
    {
      review_id: "mock_1",
      reviewer_name: "Sarah Jenkins",
      rating: 5,
      review_text:
        "Absolutely loved our stay! The staff was incredibly attentive and the view from the room was breathtaking.",
      review_date: "2 days ago",
      platform: "Booking.com"
    }
  ];

  return {
    success: true,
    reviews: mockReviews
  };
};

exports.scrapeGoogleMaps = async (url, maxReviews = 3) => {
  return exports.openGoogleMaps(url, maxReviews);
};

/**
 * Expedia Review Scraper (Open Browser Only for now)
 */
exports.openExpediaReviews = async (url, limit = 20, headless = false, existingKeys = [], minRating = 1, maxRating = 5) => {
  console.log(`Launching browser for Expedia (Headless: ${headless})...`);

  try {
    const browser = await puppeteer.launch({
      headless: true,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    console.log(`Opening Expedia URL: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // STEP 2 — Click initial Reviews Link to open modal
    await page.waitForSelector('button[data-stid="reviews-link"]', { visible: true, timeout: 30000 });
    await page.evaluate(() => {
      const btn = document.querySelector('button[data-stid="reviews-link"]');
      if (btn) btn.click();
    });

    // STEP 3 — Wait for review modal
    await page.waitForSelector('.uitk-expando-peek-inner', { timeout: 30000 });
    console.log('Reviews modal loaded');

    // STEP 4 — Pagination Loop (Click "More reviews")
    let attempts = 0;
    while (attempts < 15) { // Increased max attempts to fetch more for filtering
      const currentCards = await page.$$('.uitk-layout-grid.uitk-layout-grid-has-auto-columns');
      console.log(`Found ${currentCards.length} review cards...`);

      if (currentCards.length >= limit * 3) break; // Fetch a larger buffer

      const loadMoreBtn = await page.$('#load-more-reviews');
      if (!loadMoreBtn) break;

      console.log('Clicking "More reviews" button...');
      await loadMoreBtn.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await new Promise(r => setTimeout(r, 1000));
      await page.evaluate(() => document.querySelector('#load-more-reviews')?.click());

      // Wait for new content
      await new Promise(r => setTimeout(r, 4000));
      attempts++;
    }

    // STEP 5 — Final Extraction
    const reviewCards = await page.$$('.uitk-layout-grid.uitk-layout-grid-has-auto-columns');
    const existingSet = new Set(existingKeys || []);
    const uniqueReviews = new Set();
    const reviews = [];

    for (const card of reviewCards) {
      try {
        const reviewerName = await card.$eval('h4.uitk-heading.uitk-heading-7', el => el.innerText.trim()).catch(() => '');

        // Filters
        if (!reviewerName || reviewerName.length > 30 || reviewerName.includes('policy')) continue;

        const ratingText = await card.$eval('h3.uitk-heading', el => el.innerText.trim()).catch(() => '');
        const rating = parseFloat(ratingText.split('/')[0]) || null;

        if (rating !== null && (rating < minRating || rating > maxRating)) continue;

        const reviewDate = await card.$$eval('.uitk-text', els => {
          const found = els.find(el => {
            const text = el.innerText.trim();
            return text.includes('2026') || text.includes('2025') || text.includes('2024');
          });
          return found ? found.innerText.trim() : '';
        }).catch(() => '');

        const reviewText = await card.$eval('.uitk-expando-peek-inner .uitk-text', el => el.innerText.trim()).catch(() => '');
        if (!reviewText) continue;

        const uniqueKey = reviewerName + reviewText;
        if (uniqueReviews.has(uniqueKey) || existingSet.has(uniqueKey)) continue;
        uniqueReviews.add(uniqueKey);

        reviews.push({ reviewerName, rating, reviewDate, reviewText });
        if (reviews.length >= limit) break;
      } catch (e) { }
    }

    console.log(`Extracted ${reviews.length} unique Expedia reviews.`);
    return { success: true, totalReviews: reviews.length, reviews };

  } catch (err) {
    console.error('Expedia Scraper Error:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Agoda Review Scraper (Open Browser Only for now)
 */
exports.openAgodaReviews = async (url, limit = 20, headless = false, existingKeys = [], minRating = 1, maxRating = 5) => {
  console.log(`Launching browser for Agoda (Headless: ${headless})...`);

  let finalMin = minRating;
  let finalMax = maxRating;
  if (minRating === 1 && maxRating === 3) {
    finalMin = 0;
    finalMax = 3.9;
  }

  try {
    const browser = await puppeteer.launch({
      headless: true,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    console.log(`Opening Agoda URL: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // STEP 1 — Scroll down to find reviews section
    console.log('Scrolling to find reviews section...');
    let foundReviews = false;
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await new Promise(r => setTimeout(r, 1000));

      const cards = await page.$$('div[data-element-name="review-comment"]');
      if (cards.length > 0) {
        foundReviews = true;
        console.log('Reviews section found on main page.');
        break;
      }
    }

    if (!foundReviews) {
      console.log('Could not find reviews on main page. Attempting one final deep scroll...');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await new Promise(r => setTimeout(r, 3000));
    }

    // Select "Most recent" sort option
    try {
      console.log('Selecting "Most recent" sort option on Agoda...');
      const sortSelector = '#review-sort-id, select.Review-sortingSelect, select[data-element-name="reviews-sort-dropdown"]';
      await page.waitForSelector(sortSelector, { timeout: 15000 });
      await page.select(sortSelector, '1');
      console.log('Successfully selected Agoda "Most recent" sorting');
      await new Promise(r => setTimeout(r, 5000));
    } catch (sortErr) {
      console.log('⚠️ [Agoda] Sorting failed or sort dropdown not found:', sortErr.message);
    }

    const existingSet = new Set(existingKeys || []);
    let allCollectedReviews = [];
    let currentPage = 1;
    const uniqueReviews = new Set();

    // PAGINATION LOOP
    while (currentPage < 10) {
      console.log(`Extracting Agoda reviews from page ${currentPage}...`);

      // Wait for content
      await new Promise(r => setTimeout(r, 3000));

      // Extract current page reviews
      const pageReviews = await page.$$eval('div[data-element-name="review-comment"]', (cards) => {
        return cards.map(card => {
          const reviewerName = card.querySelector('[data-info-type="reviewer-name"] strong')?.innerText?.trim() ||
            card.querySelector('.Review-comment-reviewer span')?.innerText?.trim() || '';

          const ratingText = card.querySelector('.Review-comment-leftScore')?.innerText?.trim() || '';
          const rating = parseFloat(ratingText) || null;

          const reviewDate = card.querySelector('.Review-statusBar-left span')?.innerText?.trim() || '';

          const reviewTitle = card.querySelector('[data-testid="review-title"]')?.innerText?.trim() || '';

          const reviewTextOnly = card.querySelector('[data-testid="review-comment"]')?.innerText?.trim() || '';
          const reviewText = `${reviewTitle} ${reviewTextOnly}`.trim();

          return { reviewerName, rating, reviewDate, reviewText };
        });
      });

      const allOlder = pageReviews.every(r => isOlderThan3Months(r.reviewDate));
      if (allOlder && pageReviews.length > 0) {
        console.log('[Agoda] All reviews older than 3 months. Stopping.');
        break;
      }

      // Filter and Add
      for (const r of pageReviews) {
        if (!r.reviewerName || !r.reviewText) continue;

        let normRating = 5;
        if (r.rating !== null) {
          normRating = Math.round((r.rating / 2) * 10) / 10;
        }
        if (normRating < finalMin || normRating > finalMax) continue;

        const key = r.reviewerName + r.reviewText;
        const isNew = !existingSet.has(key);
        const isNotOlder = !isOlderThan3Months(r.reviewDate);
        if (isNew && isNotOlder && !uniqueReviews.has(key)) {
          uniqueReviews.add(key);
          allCollectedReviews.push(r);
        }
      }

      console.log(`Total Agoda reviews so far: ${allCollectedReviews.length}`);

      // if (hitOlder) {
      //   console.log(`[Agoda] Encountered review older than 3 months. Stopping scraper.`);
      //   break;
      // }

      if (allCollectedReviews.length >= limit) break;

      // Click Next Page (Numeric Button on Main Page)
      currentPage++;
      const clicked = await page.evaluate((nextPage) => {
        const buttons = Array.from(document.querySelectorAll('button p, button span'));
        const target = buttons.find(el => el.innerText.trim() === String(nextPage));
        if (target) {
          const btn = target.closest('button');
          if (btn) {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            btn.click();
            return true;
          }
        }
        return false;
      }, currentPage);

      if (!clicked) {
        console.log(`Could not find button for page ${currentPage}. stopping.`);
        break;
      }

      // Wait for page load
      await new Promise(r => setTimeout(r, 5000));
    }

    console.log(`Agoda Sync Finished. Total: 	ext{allCollectedReviews.length}`);
    return { success: true, totalReviews: allCollectedReviews.length, reviews: allCollectedReviews.slice(0, limit) };

  } catch (err) {
    console.error('Agoda Scraper Error:', err);
    return { success: false, message: err.message };
  }
};

exports.openHotelsReviews = async (url) => {
  console.log('Launching browser for Hotels.com...');

  try {
    const browser = await puppeteer.launch({
      headless: true,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    console.log(`Opening Hotels.com URL: ${url}`);

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('Hotels.com page fully loaded');

    // STEP 1 — Wait for reviews button if visible
    await page.waitForSelector(
      'button[data-stid="reviews-link"]',
      {
        visible: true,
        timeout: 30000
      }
    );

    console.log('Reviews button found');

    // STEP 2 — Scroll button into view
    await page.evaluate(() => {
      const btn = document.querySelector(
        'button[data-stid="reviews-link"]'
      );

      if (btn) {
        btn.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // STEP 3 — Click button
    await page.evaluate(() => {
      const btn = document.querySelector(
        'button[data-stid="reviews-link"]'
      );

      if (btn) {
        btn.click();
      }
    });

    console.log('Clicked See all reviews');

    // Create a timeout promise
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          timeout: true,
          success: true,
          message: 'Hotels.com scraping is taking longer than expected due to security measures. Please copy reviews manually if they do not appear shortly.'
        });
      }, 60000); // 1 minute
    });

    // Create the scraping promise
    const scrapingPromise = (async () => {
      try {
        // STEP 4 — Wait for review cards
        await page.waitForSelector(
          '.uitk-layout-grid.uitk-layout-grid-has-auto-columns',
          { timeout: 30000 }
        );

        // Small delay
        await new Promise(resolve => setTimeout(resolve, 3000));

        // STEP 5 — Extract reviews
        const reviewCards = await page.$$(
          '.uitk-layout-grid.uitk-layout-grid-has-auto-columns'
        );

        const uniqueReviews = new Set();
        const reviews = [];
        const limit = 3;

        for (const card of reviewCards) {
          try {
            await card.evaluate(el => {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            await new Promise(resolve => setTimeout(resolve, 300));

            const reviewerName = await card.$eval('h4.uitk-heading.uitk-heading-7', el => el.innerText.trim()).catch(() => '');
            if (!reviewerName || reviewerName === 'What guests liked' || reviewerName.length > 30) continue;

            const ratingText = await card.$eval('h3.uitk-heading', el => el.innerText.trim()).catch(() => '');
            const rating = parseFloat(ratingText.split('/')[0]) || null;

            const reviewDate = await card.$$eval('.uitk-text', els => {
              const found = els.find(el => {
                const text = el.innerText.trim();
                return text.includes('2026') || text.includes('2025') || text.includes('2024');
              });
              return found ? found.innerText.trim() : '';
            }).catch(() => '');

            const reviewText = await card.$eval('.uitk-expando-peek-inner .uitk-text', el => el.innerText.trim()).catch(() => '');
            if (!reviewText) continue;

            const uniqueKey = reviewerName + reviewText;
            if (uniqueReviews.has(uniqueKey)) continue;
            uniqueReviews.add(uniqueKey);

            reviews.push({ reviewerName, rating, reviewDate, reviewText });
            if (reviews.length >= limit) break;
          } catch (e) { }
        }

        return {
          success: true,
          totalReviews: reviews.length,
          reviews
        };
      } catch (err) {
        console.error('Inner Scraper Error:', err);
        return { success: true, message: 'Scraping failed or timed out. Please check the opened browser window.' };
      }
    })();

    // Race the scraping against the timeout
    const result = await Promise.race([scrapingPromise, timeoutPromise]);
    return result;

  } catch (err) {
    console.error('Hotels.com Scraper Error:', err);
    throw err;
  }
};

/**
 * Airbnb Review Scraper (Open Browser Only for now)
 */

exports.openAirbnbReviews = async (url, limit = 5, headless = true, existingKeys = [], minRating = 1, maxRating = 5) => {
  console.log('Launching browser for Airbnb...');

  try {
    const browser = await puppeteer.launch({
      headless: true,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    console.log(`Opening Airbnb URL: ${url}`);

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('Airbnb page fully loaded');

    // WAIT A LITTLE
    await new Promise(resolve =>
      setTimeout(resolve, 5000)
    );

    // CLICK REVIEWS BUTTON
    await page.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll('button, span')
      );

      const reviewBtn = elements.find(el =>
        el.innerText &&
        el.innerText.toLowerCase().includes('reviews')
      );

      if (reviewBtn) {
        reviewBtn.click();
      }
    });

    console.log('Clicked reviews button');

    // WAIT FOR MODAL TO OPEN
    await new Promise(resolve =>
      setTimeout(resolve, 5000)
    );

    let scrollAttempts = 0;
    const maxScrollAttempts = 30;
    const existingSet = new Set(existingKeys || []);
    let finalReviews = [];

    console.log(`Scrolling and extracting Airbnb reviews (limit: ${limit}, cutoff: 3 months)...`);

    while (scrollAttempts < maxScrollAttempts) {
      // 1. Extract reviews
      let currentReviews = await page.$$eval(
        'div[data-review-id]',
        (cards) => {
          const results = [];
          for (const card of cards) {
            try {
              const responseHeading = card.querySelector('h2')?.innerText || '';
              if (responseHeading.toLowerCase().includes('response from')) {
                continue;
              }

              const reviewerName = card.querySelector('h2[aria-level="2"]')?.innerText?.trim() || '';
              if (!reviewerName) continue;

              let reviewDate = '';
              const possibleDates = card.querySelectorAll('div[class*="1h3mmnw"]');
              possibleDates.forEach(el => {
                const text = el.innerText?.trim() || '';
                if (text.includes('2025') || text.includes('2026') || text.includes('2024')) {
                  reviewDate = text;
                }
              });

              const reviewText = card.querySelector('.ljci3ej')?.innerText?.trim() || '';
              if (!reviewText) continue;

              let rating = null;
              const ratingLabel = card.querySelector('span[aria-hidden="true"]')?.innerText || '';
              if (ratingLabel.toLowerCase().includes('5')) {
                rating = 5;
              }

              results.push({
                reviewerName,
                rating,
                reviewDate,
                reviewText
              });
            } catch (e) { }
          }
          return results;
        }
      );

      // Filter against DB keys and rating
      const uniqueReviewsMap = new Map();
      currentReviews.forEach(r => {
        const meetsRating = r.rating >= minRating && r.rating <= maxRating;
        const key = r.reviewerName + r.reviewText;
        if (meetsRating && !uniqueReviewsMap.has(key)) {
          uniqueReviewsMap.set(key, r);
        }
      });

      const uniqueReviewsList = Array.from(uniqueReviewsMap.values());

      const allOlder = uniqueReviewsList.every(r => isOlderThan3Months(r.reviewDate));
      if (allOlder && uniqueReviewsList.length > 0) {
        console.log('[Airbnb] All reviews older than 3 months. Stopping.');
        break;
      }
      const filtered = uniqueReviewsList.filter(r => {
        const key = r.reviewerName + r.reviewText;
        const isNotOlder = !isOlderThan3Months(r.reviewDate);
        return !existingSet.has(key) && isNotOlder;
      });

      console.log(`Found ${currentReviews.length} total reviews, 	ext{filtered.length} match criteria...`);

      // if (hitOlder) {
      //   console.log(`[Airbnb] Encountered review older than 3 months. Stopping scraper.`);
      //   finalReviews = filtered;
      //   break;
      // }

      if (filtered.length >= limit) {
        finalReviews = filtered.slice(0, limit);
        break;
      }

      // 3. Scroll modal down
      await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"]');
        if (modal) {
          modal.scrollBy(0, 2000);
        } else {
          window.scrollBy(0, 2000);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 3000));
      scrollAttempts++;

      finalReviews = filtered;
    }

    console.log('Airbnb Reviews Extracted (Deduplicated & New):', finalReviews);

    return {
      success: true,
      totalReviews: finalReviews.length,
      reviews: finalReviews.slice(0, limit)
    };

  } catch (err) {
    console.error('Airbnb Scraper Error:', err);
    return {
      success: false,
      message: err.message
    };
  }
};
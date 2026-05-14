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
 * Google Maps Review Scraper
 */


exports.openGoogleMaps = async (url, limit = 3) => {
  console.log('Launching browser...');

  try {
    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    console.log(`Opening URL: ${url}`);

    // STEP 1 — Open Google Page
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('Website fully loaded');

    // STEP 2 — Click Reviews Tab
    await page.waitForSelector(
      'div[role="tab"][aria-label="Reviews"]',
      { timeout: 20000 }
    );

    await page.click(
      'div[role="tab"][aria-label="Reviews"]'
    );

    console.log('Reviews tab clicked');

    // STEP 3 — Wait Reviews
    await page.waitForSelector('.Svr5cf.bKhjM', {
      timeout: 20000
    });

    // Small delay for rendering
    await new Promise(resolve => setTimeout(resolve, 2000));

    // STEP 4 — Click ALL Read More buttons
    const readMoreButtons = await page.$$(
      'span.Jmi7d.TJUuge'
    );

    console.log(
      `Found ${readMoreButtons.length} read more buttons`
    );

    for (const btn of readMoreButtons) {
      try {
        await btn.evaluate(el => {
          el.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        });

        await new Promise(resolve => setTimeout(resolve, 500));

        await btn.click();

        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err) {
        console.log(
          'Read more click failed:',
          err.message
        );
      }
    }

    console.log('Expanded all reviews');

    // STEP 5 — Extract Reviews
    let reviews = await page.$$eval(
      '.Svr5cf.bKhjM',
      (cards) => {
        return cards.map(card => {
          // Reviewer Name
          const reviewerName =
            card.querySelector('.DHIhE.QB2Jof')
              ?.innerText?.trim() || '';

          // Rating
          const ratingText =
            card.querySelector('.GDWaad')
              ?.innerText?.trim() || '';

          const rating =
            parseFloat(ratingText.split('/')[0]) || null;

          // Review Date
          const reviewDate =
            card.querySelector('.iUtr1.CQYfx')
              ?.innerText?.trim() || '';

          // FULL Review Text
          let reviewText = '';

          // Expanded review
          const expandedReview =
            card.querySelector(
              'div[jsname="NwoMSd"] span'
            )?.innerText?.trim();

          // Short review fallback
          const shortReview =
            card.querySelector(
              'div[jsname="kmPxT"] span'
            )?.innerText?.trim();

          reviewText =
            expandedReview ||
            shortReview ||
            '';

          // Stay Type
          const stayType =
            card.querySelector('.ThUm5b span')
              ?.innerText?.trim() || '';

          return {
            reviewerName,
            rating,
            reviewDate,
            stayType,
            reviewText
          };
        });
      }
    );

    // Remove duplicates
    reviews = removeDuplicateReviews(reviews);

    // Take only required limit
    reviews = reviews.slice(0, limit);

    console.log('Reviews Extracted (Deduplicated):', reviews);

    return {
      success: true,
      totalReviews: reviews.length,
      reviews
    };

  } catch (err) {
    console.error('Scraper Error:', err);
    throw err;
  }
};

/**
 * Step 1: Open Booking.com and click the Reviews tab
 */
exports.openBookingReviews = async (url, limit = 4) => {
  console.log('Launching browser for Booking...');

  try {
    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    console.log(`Opening Booking URL: ${url}`);

    // Open Booking.com page
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('Booking page fully loaded');

    // Wait for reviews tab button
    await page.waitForSelector(
      '#reviews-tab-trigger',
      {
        timeout: 20000
      }
    );

    console.log('Reviews button found');

    // Scroll into view
    await page.$eval(
      '#reviews-tab-trigger',
      el => {
        el.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    );

    await new Promise(resolve =>
      setTimeout(resolve, 1000)
    );

    // Click reviews tab
    await page.click('#reviews-tab-trigger');

    console.log('Reviews tab clicked');

    // Wait reviews to load
    await page.waitForSelector('[data-testid="review-card"]', {
      timeout: 20000
    });

    // STEP — Extract Booking.com Reviews
    let reviews = await page.$$eval(
      '[data-testid="review-card"]',
      (cards) => {
        return cards.map(card => {
          // Reviewer Name
          const reviewerName =
            card.querySelector('.b08850ce41')
              ?.innerText?.trim() || '';

          // Country
          const country =
            card.querySelector('.d838fb5f41')
              ?.innerText?.trim() || '';

          // Room Type
          const roomType =
            card.querySelector(
              '[data-testid="review-room-name"]'
            )?.innerText?.trim() || '';

          // Stay Duration
          const stayDuration =
            card.querySelector(
              '[data-testid="review-num-nights"]'
            )?.innerText?.trim() || '';

          // Stay Date
          const stayDate =
            card.querySelector(
              '[data-testid="review-stay-date"]'
            )?.innerText?.trim() || '';

          // Traveler Type
          const travelerType =
            card.querySelector(
              '[data-testid="review-traveler-type"]'
            )?.innerText?.trim() || '';

          // Review Date
          const reviewDate =
            card.querySelector(
              '[data-testid="review-date"]'
            )?.innerText?.trim() || '';

          // Review Title
          const reviewTitle =
            card.querySelector(
              '[data-testid="review-title"]'
            )?.innerText?.trim() || '';

          // Positive Review
          const positiveReview =
            card.querySelector(
              '[data-testid="review-positive-text"] span'
            )?.innerText?.trim() || '';

          // Negative Review
          const negativeReview =
            card.querySelector(
              '[data-testid="review-negative-text"] span'
            )?.innerText?.trim() || '';

          // Final Combined Review
          const reviewText = [
            reviewTitle,
            positiveReview,
            negativeReview
          ]
            .filter(Boolean)
            .join(' ');

          // Rating
          const ratingText =
            card.querySelector('.f63b14ab7a')
              ?.innerText?.trim() || '';

          const rating =
            parseFloat(ratingText) || null;

          return {
            reviewerName,
            country,
            roomType,
            stayDuration,
            stayDate,
            travelerType,
            reviewDate,
            rating,
            reviewText
          };
        });
      }
    );

    // Remove duplicates
    reviews = removeDuplicateReviews(reviews);

    // Take only required limit
    reviews = reviews.slice(0, limit);

    console.log('Booking Reviews Extracted (Deduplicated):', reviews);

    return {
      success: true,
      totalReviews: reviews.length,
      reviews
    };

  } catch (err) {
    console.error('Booking Scraper Error:', err);
    throw err;
  }
};


/**
 * Mock Booking Scraper
 */
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
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


exports.openGoogleMaps = async (url, limit = 30, headless = true, existingKeys = [], minRating = 1, maxRating = 5) => {
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

    // STEP 3 — Scroll Loop to Load More Reviews
    let scrollAttempts = 0;
    const maxScrollAttempts = 40;
    const existingSet = new Set(existingKeys || []);
    let finalReviews = [];

    console.log(`Scrolling and extracting to guarantee ${limit} new reviews within ${minRating}-${maxRating} stars...`);

    while (scrollAttempts < maxScrollAttempts) {
      // 1. Click any visible 'Read more' buttons to ensure we get full text
      const readMoreButtons = await page.$$('span.Jmi7d.TJUuge');
      for (const btn of readMoreButtons) {
        try {
          // Check if it's already expanded (the button disappears or becomes hidden, but just in case)
          const isVisible = await btn.evaluate(b => b.offsetWidth > 0 && b.offsetHeight > 0);
          if (isVisible) {
            await btn.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            await new Promise(r => setTimeout(r, 200));
            await btn.click();
            await new Promise(r => setTimeout(r, 200));
          }
        } catch (e) {}
      }

      // 2. Extract current reviews on the page
      let currentReviews = await page.$$eval('.Svr5cf.bKhjM', (cards) => {
        return cards.map(card => {
          const reviewerName = card.querySelector('.DHIhE.QB2Jof')?.innerText?.trim() || '';
          const ratingText = card.querySelector('.GDWaad')?.innerText?.trim() || '';
          const rating = parseFloat(ratingText.split('/')[0]) || null;
          const reviewDate = card.querySelector('.iUtr1.CQYfx')?.innerText?.trim() || '';
          const expandedReview = card.querySelector('div[jsname="NwoMSd"] span')?.innerText?.trim();
          const shortReview = card.querySelector('div[jsname="kmPxT"] span')?.innerText?.trim();
          const reviewText = expandedReview || shortReview || '';
          const stayType = card.querySelector('.ThUm5b span')?.innerText?.trim() || '';

          return { reviewerName, rating, reviewDate, stayType, reviewText };
        });
      });

      // 3. Filter against DB keys and rating
      const deduplicated = removeDuplicateReviews(currentReviews);
      const newReviews = deduplicated.filter(r => {
        const meetsRating = r.rating >= minRating && r.rating <= maxRating;
        const isNew = !existingSet.has(r.reviewerName + r.reviewText);
        return meetsRating && isNew;
      });

      console.log(`Found ${currentReviews.length} total reviews, ${newReviews.length} match criteria...`);

      if (newReviews.length >= limit) {
        finalReviews = newReviews.slice(0, limit);
        break;
      }

      // 4. Scroll down to load more
      await page.evaluate(() => {
        const cards = document.querySelectorAll('.Svr5cf.bKhjM');
        if (cards.length > 0) {
          cards[cards.length - 1].scrollIntoView();
        }
        window.scrollBy(0, 800);
      });

      await new Promise(r => setTimeout(r, 3000));
      scrollAttempts++;
      
      // If we hit the end of the loop but didn't break, update finalReviews with what we have
      finalReviews = newReviews;
    }

    console.log('Scroll loop finished.');
    console.log('Reviews Extracted (Deduplicated & New):', finalReviews);

    return {
      success: true,
      totalReviews: finalReviews.length,
      reviews: finalReviews
    };

  } catch (err) {
    console.error('Scraper Error:', err);
    throw err;
  }
};

/**
 * Step 1: Open Booking.com and click the Reviews tab
 */
exports.openBookingReviews = async (url, limit = 3, headless = false, existingKeys = [], minRating = 1, maxRating = 5) => {
  console.log(`Launching browser for Booking (Headless: ${headless})...`);

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

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    console.log(`Opening Booking URL: ${url}`);

    // OPEN PAGE
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('Booking page fully loaded');

    // WAIT REVIEWS TAB
    try {
      await page.waitForSelector(
        '#reviews-tab-trigger',
        {
          timeout: 10000
        }
      );

      // SCROLL TO REVIEWS
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
        setTimeout(resolve, 2000)
      );

      // CLICK REVIEWS TAB
      await page.evaluate(() => {
        const btn = document.querySelector(
          '#reviews-tab-trigger'
        );
        if (btn) {
          btn.click();
        }
      });

      console.log('Reviews tab clicked');
    } catch (tabErr) {
      console.log('⚠️ [Booking.com] Timeout waiting for #reviews-tab-trigger or element not found. Proceeding to look for reviews directly...');
    }

    // WAIT POPUP
    await new Promise(resolve =>
      setTimeout(resolve, 8000)
    );

    // WAIT REVIEWS
    try {
      await page.waitForSelector(
        '[data-testid="review-card"]',
        {
          timeout: 25000
        }
      );
    } catch (err) {
      console.log('⚠️ [Booking.com] Timeout waiting for review cards. The page may have a classic layout, captcha, or zero reviews.');
      await browser.close();
      return [];
    }
    const existingSet = new Set(existingKeys || []);
    let allReviews = [];
    let currentPage = 1;

    // =========================
    // LOOP THROUGH PAGES
    // =========================

    while (true) {

      console.log(
        `Extracting reviews from page ${currentPage}`
      );

      // WAIT SMALL
      await new Promise(resolve =>
        setTimeout(resolve, 3000)
      );

      // EXTRACT REVIEWS
      const currentReviews = await page.$$eval(
        '[data-testid="review-card"]',
        cards => {

          const unique = new Set();
          const results = [];

          for (const card of cards) {

            try {

              // REVIEWER NAME
              const reviewerName =
                card.querySelector('.b08850ce41')
                  ?.innerText
                  ?.trim() || '';

              // REVIEW DATE
              const reviewDate =
                card.querySelector(
                  '[data-testid="review-date"]'
                )
                  ?.innerText
                  ?.trim() || '';

              // REVIEW TITLE
              const reviewTitle =
                card.querySelector(
                  '[data-testid="review-title"]'
                )
                  ?.innerText
                  ?.trim() || '';

              // POSITIVE REVIEW
              const positiveReview =
                card.querySelector(
                  '[data-testid="review-positive-text"] span'
                )
                  ?.innerText
                  ?.trim() || '';

              // NEGATIVE REVIEW
              const negativeReview =
                card.querySelector(
                  '[data-testid="review-negative-text"] span'
                )
                  ?.innerText
                  ?.trim() || '';

              // RATING
              const ratingText =
                card.querySelector('.f63b14ab7a')
                  ?.innerText
                  ?.trim() || '';

              const rating =
                parseFloat(ratingText) || null;

              // REVIEW TEXT
              const reviewText = [
                reviewTitle,
                positiveReview,
                negativeReview
              ]
                .filter(Boolean)
                .join(' ');

              // SKIP EMPTY
              if (!reviewerName || !reviewText) {
                continue;
              }

              // UNIQUE CHECK
              const key =
                reviewerName + reviewText;

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

            } catch (e) { }
          }

          return results;
        }
      );

      const newReviews = currentReviews.filter(r => {
        let normRating = 5;
        if (r.rating !== null) {
          normRating = Math.round((r.rating / 2) * 10) / 10;
        }
        const meetsRating = normRating >= finalMin && normRating <= finalMax;
        const isNew = !existingSet.has(r.reviewerName + r.reviewText);
        return meetsRating && isNew;
      });

      // ADD REVIEWS
      allReviews = [
        ...allReviews,
        ...newReviews
      ];

      // REMOVE DUPLICATES
      allReviews = allReviews.filter(
        (review, index, self) =>
          index === self.findIndex(r =>
            r.reviewerName === review.reviewerName &&
            r.reviewText === review.reviewText
          )
      );

      console.log(
        `Total reviews collected: ${allReviews.length}`
      );

      // STOP IF LIMIT REACHED
      if (allReviews.length >= limit) {
        break;
      }

      // NEXT PAGE NUMBER
      currentPage++;

      console.log(
        `Trying to click page ${currentPage}`
      );

      // SCROLL DOWN
      for (let i = 0; i < 4; i++) {

        await page.evaluate(() => {
          window.scrollBy(0, window.innerHeight);
        });

        await new Promise(resolve =>
          setTimeout(resolve, 2000)
        );
      }

      // EXTRA WAIT
      await new Promise(resolve =>
        setTimeout(resolve, 8000)
      );

      // CLICK NEXT PAGE
      const clicked = await page.evaluate(
        (pageNo) => {

          const buttons = Array.from(
            document.querySelectorAll(
              'li.d8842cf9f4 button'
            )
          );

          const targetBtn = buttons.find(btn => {

            const aria =
              btn.getAttribute('aria-label')
                ?.trim();

            const text =
              btn.innerText?.trim();

            return (
              aria === String(pageNo) ||
              aria === ` ${pageNo}` ||
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

        },
        currentPage
      );

      console.log(
        `Page ${currentPage} clicked:`,
        clicked
      );

      // STOP IF NO MORE PAGES
      if (!clicked) {

        console.log(
          'No more pagination buttons found'
        );

        break;
      }

      // WAIT NEXT PAGE LOAD
      await new Promise(resolve =>
        setTimeout(resolve, 8000)
      );
    }

    // FINAL LIMIT
    const reviews =
      allReviews.slice(0, limit);

    console.log(
      'Final Booking Reviews:',
      reviews
    );

    return {
      success: true,
      totalReviews: reviews.length,
      reviews
    };

  } catch (err) {

    console.error(
      'Booking Scraper Error:',
      err
    );

    return {
      success: false,
      message: err.message
    };
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

    const existingSet = new Set(existingKeys || []);
    let allCollectedReviews = [];
    let currentPage = 1;
    const uniqueReviews = new Set();

    // PAGINATION LOOP
    while (allCollectedReviews.length < limit && currentPage < 10) {
      console.log(`Extracting Agoda reviews from page ${currentPage}...`);

      // Wait for content
      await new Promise(r => setTimeout(r, 3000));

      // Extract current page reviews
      const pageReviews = await page.$$eval('div[data-element-name="review-comment"]', (cards) => {
        return cards.map(card => {
          // Reviewer Name (e.g., "lisa from United States")
          const reviewerName = card.querySelector('[data-info-type="reviewer-name"] strong')?.innerText?.trim() ||
            card.querySelector('.Review-comment-reviewer span')?.innerText?.trim() || '';

          // Rating (e.g., "8.4")
          const ratingText = card.querySelector('.Review-comment-leftScore')?.innerText?.trim() || '';
          const rating = parseFloat(ratingText) || null;

          // Review Date
          const reviewDate = card.querySelector('.Review-statusBar-left span')?.innerText?.trim() || '';

          // Review Title
          const reviewTitle = card.querySelector('[data-testid="review-title"]')?.innerText?.trim() || '';

          // Review Text
          const reviewTextOnly = card.querySelector('[data-testid="review-comment"]')?.innerText?.trim() || '';
          const reviewText = `${reviewTitle} ${reviewTextOnly}`.trim();

          return { reviewerName, rating, reviewDate, reviewText };
        });
      });

      // Filter and Add
      for (const r of pageReviews) {
        if (!r.reviewerName || !r.reviewText) continue;
        
        let normRating = 5;
        if (r.rating !== null) {
          normRating = Math.round((r.rating / 2) * 10) / 10;
        }
        if (normRating < finalMin || normRating > finalMax) continue;

        const key = r.reviewerName + r.reviewText;
        if (!uniqueReviews.has(key) && !existingSet.has(key)) {
          uniqueReviews.add(key);
          allCollectedReviews.push(r);
        }
      }

      console.log(`Total Agoda reviews so far: ${allCollectedReviews.length}`);
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

    console.log(`Agoda Sync Finished. Total: ${allCollectedReviews.length}`);
    return { success: true, totalReviews: allCollectedReviews.length, reviews: allCollectedReviews.slice(0, limit) };

  } catch (err) {
    console.error('Agoda Scraper Error:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Hotels.com Review Scraper (Open Browser Only for now)
 */
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

    console.log(`Scrolling and extracting to guarantee ${limit} new reviews within ${minRating}-${maxRating} stars...`);

    while (scrollAttempts < maxScrollAttempts) {
      // 1. Extract reviews
      let currentReviews = await page.$$eval(
        'div[data-review-id]',
        (cards) => {
          const results = [];
          for (const card of cards) {
            try {
              // SKIP HOST RESPONSE BLOCKS
              const responseHeading = card.querySelector('h2')?.innerText || '';
              if (responseHeading.toLowerCase().includes('response from')) {
                continue;
              }

              // REVIEWER NAME
              const reviewerName = card.querySelector('h2[aria-level="2"]')?.innerText?.trim() || '';
              if (!reviewerName) continue;

              // REVIEW DATE
              let reviewDate = '';
              const possibleDates = card.querySelectorAll('div[class*="1h3mmnw"]');
              possibleDates.forEach(el => {
                const text = el.innerText?.trim() || '';
                if (text.includes('2025') || text.includes('2026') || text.includes('2024')) {
                  reviewDate = text;
                }
              });

              // REVIEW TEXT
              const reviewText = card.querySelector('.ljci3ej')?.innerText?.trim() || '';
              if (!reviewText) continue;

              // RATING
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

      // 2. Filter against DB keys and rating
      const uniqueReviewsMap = new Map();
      currentReviews.forEach(r => {
        const meetsRating = r.rating >= minRating && r.rating <= maxRating;
        const key = r.reviewerName + r.reviewText;
        if (meetsRating && !existingSet.has(key) && !uniqueReviewsMap.has(key)) {
          uniqueReviewsMap.set(key, r);
        }
      });
      
      const newReviews = Array.from(uniqueReviewsMap.values());
      console.log(`Found ${currentReviews.length} total reviews, ${newReviews.length} match criteria...`);

      if (newReviews.length >= limit) {
        finalReviews = newReviews.slice(0, limit);
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

      finalReviews = newReviews;
    }

    console.log('Airbnb Reviews Extracted (Deduplicated & New):', finalReviews);

    return {
      success: true,
      totalReviews: finalReviews.length,
      reviews: finalReviews
    };

  } catch (err) {
    console.error('Airbnb Scraper Error:', err);
    return {
      success: false,
      message: err.message
    };
  }
};

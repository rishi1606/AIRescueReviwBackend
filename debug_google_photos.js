require("dotenv").config();
const puppeteer = require("puppeteer");

const GOOGLE_URL = "https://www.google.com/travel/search?q=marriott%20marquis%20dubai%20creek%20hotels&qs=MidDaGtJa3UtS2lQN016TXdER2cwdlp5OHhNWFpyTkdNME56Sm9FQUU4AA&ved=0CAAQ5JsGahcKEwjQnoGG8-CUAxUAAAAAHQAAAAAQPQ&ts=CAEaNgoYEhYKDS9nLzExdms0YzQ3Mmg6BUR1YmFpEhoSFAoHCOoPEAcYEBIHCOoPEAcYERgBMgIIAioHCgU6A0lOUg&ap=MAA";

async function debug() {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  
  console.log("Loading page...");
  await page.goto(GOOGLE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  console.log("Page loaded");

  // Use the same flow as the actual scraper
  try {
    await page.waitForSelector('div[role="tab"][aria-label="Reviews"]', { timeout: 10000 });
    await page.click('div[role="tab"][aria-label="Reviews"]');
    console.log("Reviews tab clicked");
  } catch (e) {
    console.log("Reviews tab not found, trying alternative selectors...");
    // Try clicking any tab that says "Reviews"
    const clicked = await page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"]');
      for (const tab of tabs) {
        if (tab.textContent.includes("Review")) {
          tab.click();
          return tab.textContent.trim();
        }
      }
      // Try any button/link with "reviews" text
      const allEls = document.querySelectorAll('a, button, [role="tab"], [role="button"]');
      for (const el of allEls) {
        if (el.textContent?.toLowerCase().includes("review")) {
          el.click();
          return el.textContent.trim();
        }
      }
      return null;
    });
    console.log("Clicked:", clicked);
  }

  await new Promise(r => setTimeout(r, 5000));

  // Wait for review cards
  try {
    await page.waitForSelector(".Svr5cf.bKhjM", { timeout: 15000 });
    console.log("Review cards found");
  } catch (e) {
    console.log("Review cards .Svr5cf.bKhjM NOT found. Trying to find what IS on the page...");
    
    // Dump all elements that look like review containers
    const altInfo = await page.evaluate(() => {
      const results = [];
      // Look for any img with photo-related attributes
      const allImgs = document.querySelectorAll('img');
      let photoImgs = 0;
      allImgs.forEach(img => {
        if (img.alt?.includes("Photo") || img.getAttribute("jsname") === "yivTqe") {
          photoImgs++;
          results.push(`Photo img found: alt="${img.alt}" src="${(img.src || '').substring(0, 60)}..."`);
        }
      });
      results.push(`Total imgs on page: ${allImgs.length}, photo imgs: ${photoImgs}`);
      return results;
    });
    altInfo.forEach(l => console.log(l));
    await browser.close();
    process.exit(0);
  }

  // Expand "Read more" buttons
  const readMoreButtons = await page.$$("span.Jmi7d.TJUuge");
  for (const btn of readMoreButtons) {
    try {
      const vis = await btn.evaluate(el => el.offsetWidth > 0);
      if (vis) { await btn.click(); await new Promise(r => setTimeout(r, 300)); }
    } catch (e) {}
  }
  await new Promise(r => setTimeout(r, 2000));

  // DEBUG: Find photos and their DOM relationship
  const debugInfo = await page.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('.Svr5cf.bKhjM');
    results.push(`Review cards: ${cards.length}`);

    // Find ALL imgs with jsname="yivTqe" or inside .fBMzfe
    const photoImgs = document.querySelectorAll('img[jsname="yivTqe"]');
    results.push(`img[jsname="yivTqe"] on page: ${photoImgs.length}`);
    
    const fBMzfe = document.querySelectorAll('.fBMzfe');
    results.push(`.fBMzfe containers: ${fBMzfe.length}`);

    // For each review card, check ALL images inside
    cards.forEach((card, idx) => {
      const allImgs = card.querySelectorAll('img');
      const yivImgs = card.querySelectorAll('img[jsname="yivTqe"]');
      const fImgs = card.querySelectorAll('.fBMzfe img');
      
      // Get reviewer name for context
      const name = card.querySelector("a.DHIhE.QB2Jof")?.innerText?.trim() ||
                   card.querySelector('a[href*="maps/contrib"]')?.innerText?.trim() || "Unknown";
      
      results.push(`\nCard ${idx} (${name}):`);
      results.push(`  All imgs: ${allImgs.length}`);
      results.push(`  yivTqe imgs: ${yivImgs.length}`);
      results.push(`  .fBMzfe imgs: ${fImgs.length}`);
      
      // List ALL images
      allImgs.forEach((img, i) => {
        results.push(`  img[${i}]: class="${img.className?.substring(0, 40)}" alt="${img.alt}" jsname="${img.getAttribute('jsname')}" src="${(img.src || '').substring(0, 50)}..."`);
      });
      
      // Check card's outerHTML for photo-related strings
      const html = card.outerHTML;
      results.push(`  HTML contains 'fBMzfe': ${html.includes('fBMzfe')}`);
      results.push(`  HTML contains 'yivTqe': ${html.includes('yivTqe')}`);
      results.push(`  HTML contains 'Photo': ${html.includes('Photo')}`);
    });

    // Check where .fBMzfe containers actually live
    if (fBMzfe.length > 0) {
      results.push("\n--- Photo Container Ancestry ---");
      fBMzfe.forEach((el, i) => {
        let path = [];
        let cur = el;
        for (let d = 0; d < 10; d++) {
          cur = cur.parentElement;
          if (!cur) break;
          path.push(`${cur.tagName}.${(cur.className || '').split(' ')[0]}`);
          if (cur.classList?.contains('Svr5cf')) {
            path.push("(REVIEW CARD!)");
            break;
          }
        }
        results.push(`fBMzfe[${i}] path: ${path.join(' > ')}`);
      });
    }

    return results;
  });

  console.log("\n=== GOOGLE PHOTOS DEBUG ===\n");
  debugInfo.forEach(line => console.log(line));

  await browser.close();
  process.exit(0);
}

debug().catch(e => { console.error(e); process.exit(1); });

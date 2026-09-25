// Reads the US Nintendo eShop best-sellers page once and records the #1 game
// for today (Pacific time) in data/history.json.
//
//   node scripts/scrape.mjs            read the chart and save it
//   node scripts/scrape.mjs --dry-run  read the chart and print it, save nothing
//
// Optional environment variables:
//   CHART_URL       page to read (default: US best sellers)
//   CHART_SELECTOR  CSS selector for the container that holds the ranked list,
//                   if the page ever shows promo tiles above the real chart

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHART_URL = process.env.CHART_URL || 'https://www.nintendo.com/us/store/games/best-sellers/';
const CHART_SELECTOR = process.env.CHART_SELECTOR || '';
const TZ = 'America/Los_Angeles';
const DATA_FILE = path.resolve('data/history.json');
const DEBUG_DIR = path.resolve('debug');
const KEEP = 10;          // how many ranked games to store per day
const MIN_GAMES = 5;      // fewer than this means the page didn't load properly
const dryRun = process.argv.includes('--dry-run');

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function cleanTitle(t) {
  return String(t || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
}

function platformOf(text) {
  const t = String(text || '').toLowerCase();
  if (/switch[\s_-]*2/.test(t)) return 'switch2';
  if (/switch/.test(t)) return 'switch1';
  return null;
}

// Primary method: read product tiles in the order they appear on screen.
async function fromPage(page) {
  return page.evaluate((scope) => {
    const root = (scope && document.querySelector(scope)) || document;
    const seen = new Set();
    const out = [];
    for (const a of root.querySelectorAll('a[href*="/store/products/"]')) {
      const href = a.href.split(/[?#]/)[0];
      if (seen.has(href)) continue;
      const card = a.closest('li, article') || a;
      const text = (card.innerText || '').trim();
      const heading = a.querySelector('h2, h3, h4') || card.querySelector('h2, h3, h4');
      const img = a.querySelector('img[alt]');
      const title =
        (heading && heading.innerText.trim()) ||
        (a.getAttribute('aria-label') || '').trim() ||
        (img && img.alt.trim()) ||
        text.split('\n').map((s) => s.trim())
          .find((s) => s && !/^(\$|free|sale|demo|nintendo switch|\d)/i.test(s)) ||
        '';
      if (!title) continue;
      seen.add(href);
      out.push({ title, url: href, text });
    }
    return out;
  }, CHART_SELECTOR);
}

// Fallback: look for a product list inside the page's embedded Next.js data.
async function fromEmbeddedData(page) {
  const raw = await page.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent || null);
  if (!raw) return [];
  let json;
  try { json = JSON.parse(raw); } catch { return []; }
  let found = null;
  const walk = (v) => {
    if (found || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      const products = v.filter((o) => o && typeof o === 'object'
        && (typeof o.name === 'string' || typeof o.title === 'string')
        && (o.urlKey || o.sku || o.nsuid));
      if (products.length >= MIN_GAMES && products.length >= v.length * 0.8) { found = products; return; }
      v.forEach(walk);
    } else {
      Object.values(v).forEach(walk);
    }
  };
  walk(json);
  return (found || []).map((o) => ({
    title: o.name || o.title,
    url: o.urlKey ? `https://www.nintendo.com/us/store/products/${o.urlKey}/` : null,
    text: JSON.stringify([o.platformCode, o.platform, o.platformName, o.platforms]),
  }));
}

async function saveDebug(page, reason) {
  try {
    await fs.mkdir(DEBUG_DIR, { recursive: true });
    await fs.writeFile(path.join(DEBUG_DIR, 'reason.txt'), reason + '\n');
    await fs.writeFile(path.join(DEBUG_DIR, 'page.html'), await page.content());
    await page.screenshot({ path: path.join(DEBUG_DIR, 'screenshot.png'), fullPage: true });
  } catch (e) {
    console.error('Could not save debug snapshot:', e.message);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: TZ,
    viewport: { width: 1366, height: 1600 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    console.log(`Reading ${CHART_URL}`);
    await page.goto(CHART_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('a[href*="/store/products/"]', { timeout: 45_000 }).catch(() => {});
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 1200); await page.waitForTimeout(700); }
    await page.waitForTimeout(1500);

    let games = await fromPage(page);
    let method = 'page tiles';
    if (games.length < MIN_GAMES) {
      games = await fromEmbeddedData(page);
      method = 'embedded data';
    }

    games = games
      .map((g) => ({ title: cleanTitle(g.title), url: g.url, platform: platformOf(g.text) }))
      .filter((g) => g.title);

    if (games.length < MIN_GAMES) {
      await saveDebug(page, `Found only ${games.length} games on the page.`);
      throw new Error(`Found only ${games.length} games. The page layout may have changed; see the debug-snapshot artifact.`);
    }

    const firstFor = (p) => games.find((g) => g.platform === p)?.title || null;
    const record = {
      capturedAt: new Date().toISOString(),
      method,
      no1: {
        all: games[0].title,
        switch2: firstFor('switch2'),
        switch1: firstFor('switch1'),
      },
      top: games.slice(0, KEEP).map((g, i) => ({ rank: i + 1, ...g })),
    };

    console.log(`\n${today} (via ${method})`);
    record.top.forEach((g) => console.log(`${String(g.rank).padStart(2)}. ${g.title}${g.platform ? `  [${g.platform}]` : ''}`));
    console.log(`\n#1 overall:  ${record.no1.all}\n#1 Switch 2: ${record.no1.switch2 ?? '(none found)'}\n#1 Switch 1: ${record.no1.switch1 ?? '(none found)'}`);

    if (dryRun) { console.log('\nDry run: nothing saved.'); return; }

    const history = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    history.days = history.days || {};
    history.days[today] = record;
    history.days = Object.fromEntries(Object.entries(history.days).sort(([a], [b]) => a.localeCompare(b)));
    history.updatedAt = record.capturedAt;
    await fs.writeFile(DATA_FILE, JSON.stringify(history, null, 2) + '\n');
    console.log(`\nSaved ${today} to data/history.json`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });

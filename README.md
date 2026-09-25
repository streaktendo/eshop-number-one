# eShop #1 Tracker

A small site that records the #1 game on the US Nintendo eShop best-sellers
chart once a day and shows it as a calendar, a timeline, and a list of the
longest streaks.

- `scripts/scrape.mjs` opens the best-sellers page in a headless browser and
  saves today's top 10 (plus the #1 for all games, Switch 2, and Switch 1).
- `.github/workflows/record.yml` runs that script every day at about 9 AM
  Pacific and commits the result to `data/history.json`.
- `index.html` is the site. GitHub Pages serves it and it reads the JSON file.

## Setup (about 10 minutes)

1. Create a new **public** repository on GitHub (GitHub Pages is free for public repositories).
2. Upload every file in this folder, keeping the folder structure. The
   `.github/workflows` folder has to be included.
3. **Settings → Pages**: set Source to "Deploy from a branch", branch `main`,
   folder `/ (root)`. Save.
4. **Settings → Actions → General → Workflow permissions**: choose
   "Read and write permissions". Save.
5. **Actions tab → "Record eShop #1" → Run workflow.** Open the run and look
   at the "Read today's chart" step. It prints the top 10 it found.
   **Compare that list to the real best-sellers page.** If they match, you're done.

The site will be at `https://<your-username>.github.io/<repo-name>/`.

## If the first run is wrong or fails

The script can't be tested against Nintendo's live site in advance, so the
first run is the real test. When a run fails, GitHub emails you, and the run page
has a `debug-snapshot` download with a screenshot and the page HTML.

- **The list doesn't match (for example, promo tiles show up first):** find the
  CSS selector for the element that wraps the real ranked grid and add it to the
  "Read today's chart" step:

  ```yaml
  - name: Read today's chart
    run: node scripts/scrape.mjs
    env:
      CHART_SELECTOR: "your-selector-here"
  ```
- **Switch 1 or Switch 2 shows "(none found)":** the page may list only one
  platform, or tiles may not say which platform they're for. The overall #1
  still works. Send the debug snapshot to Claude to adjust it.
- **Blocked or empty page:** Nintendo may be refusing automated visits.
  Re-run once. If it keeps happening, this approach needs a different data source.

## Notes

- Dates are Pacific time. A run on the same day twice overwrites that day.
- A day with no recording ends a streak.
- The chart ranks games by revenue over roughly the last three days, so
  "#1 on a day" means "#1 when the daily check ran."
- To test locally: `npm install`, `npx playwright install chromium`,
  then `npm run test-scrape` (prints the chart, saves nothing).

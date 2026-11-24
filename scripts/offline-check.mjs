// Truth check for "Nothing you type leaves your device", run on the home page that holds the generator.
//   node scripts/run-check.mjs scripts/offline-check.mjs
// The browser goes offline after the page loads. The generator must still make a code from what is typed, the download must still
// work, and no request of any kind (even a failed one) may be attempted after the load.
import { chromium } from "playwright-core";
import { CHROME } from "./_paths.mjs";

export default async function ({ base }) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const fails = [];
  const ok = (cond, msg) => {
    console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
    if (!cond) fails.push(msg);
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "load" });
    await page.waitForTimeout(500);
    await ctx.setOffline(true);
    const after = [];
    page.on("request", (r) => { if (!/^(blob|data):/.test(r.url())) after.push(r.url()); });
    page.on("requestfailed", (r) => { if (!/^(blob|data):/.test(r.url())) after.push("failed " + r.url()); });
    const input = page.locator("#generator input[type=text], #generator input[type=url], #generator input:not([type])").first();
    const secret = "https://example.com/offline-check-7431";
    await input.fill(secret);
    await page.waitForTimeout(600);
    const sel = "#generator .area-preview svg, #generator .area-preview canvas, #generator .area-preview img";
    const snap = async () => page.$eval(sel, (e) => (e.tagName === "CANVAS" ? e.toDataURL() : e.tagName === "IMG" ? e.src : e.outerHTML));
    const first = await snap();
    await input.fill("https://example.com/another-offline-9");
    await page.waitForTimeout(600);
    const second = await snap();
    ok(first !== second, "offline: the drawn code changes when the typed address changes");
    const svg = await page.locator("#generator .area-preview svg, #generator .area-preview canvas, #generator .area-preview img").count();
    ok(svg > 0, `offline: a code is drawn (${svg} drawing element(s))`);
    const btn = page.getByRole("button", { name: /download|png/i }).first();
    let downloaded = false;
    try {
      const [d] = await Promise.all([page.waitForEvent("download", { timeout: 4000 }), btn.click()]);
      downloaded = (await d.suggestedFilename()).length > 0;
    } catch {}
    ok(downloaded, "offline: the download works");
    ok(after.length === 0, `no request attempted after the page loaded, even failed ones (${after.join(", ") || "none"})`);
    await ctx.close();
  } finally {
    await browser.close();
  }
  if (fails.length) { console.error(`${fails.length} offline check(s) failed`); process.exit(1); }
  console.log("offline checks passed");
}

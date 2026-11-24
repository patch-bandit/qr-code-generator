// Where the check scripts find a browser. A missing browser never throws at import (CHROME is then undefined and CHROME_ERROR
// holds the reason; requireChrome() throws it). Order:
//   1. the CHROME_PATH environment variable (the chrome executable itself),
//   2. the PLAYWRIGHT_BROWSERS_PATH environment variable (the folder that holds the chromium-NNNN folders; the newest one wins).
import fs from "node:fs";
import path from "node:path";

function newestChromeIn(base) {
  const builds = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)) : [];
  builds.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of builds) {
    const exe = path.join(base, d, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const hit = newestChromeIn(path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH));
    if (hit) return hit;
  }
  throw new Error("No Playwright chromium found. Set CHROME_PATH (the chrome executable) or PLAYWRIGHT_BROWSERS_PATH (the folder that holds the chromium-NNNN folders).");
}

let chrome, chromeError;
try { chrome = findChrome(); } catch (e) { chromeError = e.message; }
export const CHROME = chrome;
export const CHROME_ERROR = chromeError;
export function requireChrome() { if (!chrome) throw new Error(chromeError); return chrome; }

const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/tmp/daiyujin-pw/node_modules/playwright");

const outDir = "D:/myfirstgithubcode/daiyujinweb/output/playwright/online-quote-demo";
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on("console", msg => logs.push(`[console:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", err => logs.push(`[pageerror] ${err.message}`));
  await page.goto("https://mfg-solution.com/online-quote/", { waitUntil: "networkidle", timeout: 90000 });
  await page.screenshot({ path: path.join(outDir, "inspect-landing.png"), fullPage: true });
  const info = await page.evaluate(() => {
    const elInfo = el => ({
      tag: el.tagName,
      type: el.getAttribute("type"),
      name: el.getAttribute("name"),
      id: el.id,
      text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 120),
      cls: el.className,
      hidden: el.hidden,
    });
    return {
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText.slice(0, 3000),
      inputs: [...document.querySelectorAll("input, select, textarea, button, a")].map(elInfo),
      forms: [...document.querySelectorAll("form")].map(elInfo),
      apiBase: window.DAIYUJIN_API_BASE || null,
    };
  });
  fs.writeFileSync(path.join(outDir, "inspect-info.json"), JSON.stringify({ info, logs }, null, 2), "utf8");
  await browser.close();
})();

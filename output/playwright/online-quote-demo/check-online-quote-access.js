const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/tmp/daiyujin-pw/node_modules/playwright");

const outDir = "D:/myfirstgithubcode/daiyujinweb/output/playwright/online-quote-demo";
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const userDataDir = "C:/tmp/daiyujin-pw/profile-online-quote";
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "Asia/Shanghai",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto("https://mfg-solution.com/online-quote/", { waitUntil: "domcontentloaded", timeout: 90000 });
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    const text = await page.locator("body").innerText().catch(() => "");
    if (!/Checking the site connection security|requires cookies/i.test(text)) {
      break;
    }
  }
  await page.screenshot({ path: path.join(outDir, "access-check.png"), fullPage: true });
  const result = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    text: document.body.innerText.slice(0, 2000),
    inputs: [...document.querySelectorAll("input, select, button, a")].map(el => ({
      tag: el.tagName,
      type: el.getAttribute("type"),
      name: el.getAttribute("name"),
      id: el.id,
      text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 100),
      cls: el.className,
    })),
  }));
  fs.writeFileSync(path.join(outDir, "access-check.json"), JSON.stringify(result, null, 2), "utf8");
  await context.close();
})();

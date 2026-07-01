const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/tmp/daiyujin-pw/node_modules/playwright");

const outDir = "D:/myfirstgithubcode/daiyujinweb/output/playwright/online-quote-demo";
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const context = await chromium.launchPersistentContext("C:/tmp/daiyujin-pw/manual-profile-online-quote", {
    headless: false,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    viewport: { width: 1440, height: 1100 },
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto("https://mfg-solution.com/online-quote/", { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
  console.log("Chrome is open. If a security challenge appears, complete it in the browser window.");
  console.log("Waiting up to 5 minutes for the online quote page...");

  const deadline = Date.now() + 5 * 60 * 1000;
  let ready = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const text = await page.locator("body").innerText().catch(() => "");
    const hasQuoteUi = /Instant Quote|Reference Estimate|Upload STEP|Choose STEP|Material/i.test(text);
    const isChallenge = /Checking the site connection security|requires cookies|captcha/i.test(text);
    if (hasQuoteUi && !isChallenge) {
      ready = true;
      break;
    }
  }

  await page.screenshot({ path: path.join(outDir, ready ? "manual-access-ready.png" : "manual-access-not-ready.png"), fullPage: true });
  const result = await page.evaluate(() => ({
    ready: Boolean(document.querySelector("[data-quote-form]")) || /Instant Quote|Reference Estimate|Upload STEP|Choose STEP/i.test(document.body.innerText),
    title: document.title,
    url: location.href,
    text: document.body.innerText.slice(0, 3000),
    inputs: [...document.querySelectorAll("input, select, button, a")].map(el => ({
      tag: el.tagName,
      type: el.getAttribute("type"),
      name: el.getAttribute("name"),
      id: el.id,
      text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 100),
      cls: el.className,
    })),
  }));
  fs.writeFileSync(path.join(outDir, "manual-access-result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({ ready, url: result.url, title: result.title }, null, 2));
  await context.close();
})();

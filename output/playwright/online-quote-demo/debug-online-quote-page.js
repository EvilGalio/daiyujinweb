const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/tmp/daiyujin-pw/node_modules/playwright");

const outDir = "D:/myfirstgithubcode/daiyujinweb/output/playwright/online-quote-demo";
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const context = await chromium.launchPersistentContext("C:/tmp/daiyujin-pw/manual-profile-online-quote", {
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    viewport: { width: 1440, height: 1100 },
  });
  const page = context.pages()[0] || await context.newPage();
  const events = [];
  page.on("console", msg => events.push({ type: "console", level: msg.type(), text: msg.text() }));
  page.on("pageerror", err => events.push({ type: "pageerror", text: err.message }));
  page.on("requestfailed", req => events.push({ type: "requestfailed", url: req.url(), failure: req.failure()?.errorText }));
  page.on("response", async res => {
    const url = res.url();
    if (/api\.daiyujin|quote|dyj|daiyujin-tools|wp-content\/plugins/i.test(url)) {
      events.push({ type: "response", status: res.status(), url, headers: res.headers() });
    }
  });
  await page.goto("https://mfg-solution.com/online-quote/", { waitUntil: "domcontentloaded", timeout: 90000 });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const status = document.querySelector("[data-api-status]")?.textContent || "";
      const processCount = document.querySelectorAll("[data-process-select] option").length;
      const materialButtons = document.querySelectorAll("[data-material-picker] [data-mat-id]").length;
      return /API ready/i.test(status) && processCount > 1 && materialButtons > 0;
    }).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: path.join(outDir, "debug-page-after-wait.png"), fullPage: true });
  const state = await page.evaluate(async () => {
    const out = {
      title: document.title,
      url: location.href,
      apiBase: window.DAIYUJIN_API_BASE || null,
      status: document.querySelector("[data-api-status]")?.textContent || null,
      processOptions: [...document.querySelectorAll("[data-process-select] option")].map(o => o.textContent),
      quoteScript: [...document.scripts].map(s => s.src).filter(src => /quote|api|config|daiyujin-tools/i.test(src)),
      bodyText: document.body.innerText.slice(0, 1500),
    };
    try {
      const r = await fetch("https://api.daiyujin.dpdns.org/api/public/quote/options");
      out.fetchOptionsStatus = r.status;
      out.fetchOptionsText = (await r.text()).slice(0, 600);
    } catch (e) {
      out.fetchOptionsError = String(e && e.message || e);
    }
    try {
      const r = await fetch("https://api.daiyujin.dpdns.org/api/health");
      out.fetchHealthStatus = r.status;
      out.fetchHealthText = (await r.text()).slice(0, 300);
    } catch (e) {
      out.fetchHealthError = String(e && e.message || e);
    }
    return out;
  });
  fs.writeFileSync(path.join(outDir, "debug-page-state.json"), JSON.stringify({ state, events }, null, 2), "utf8");
  await context.close();
})();

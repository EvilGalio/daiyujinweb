const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/tmp/daiyujin-pw/node_modules/playwright");

const videoPath = "C:/Users/14539/Documents/xwechat_files/wxid_komgiuv5b9q612_2758/msg/video/2026-06/b932571ee39907fa91a20d7d1238f1bd.mp4";
const outDir = "D:/myfirstgithubcode/daiyujinweb/output/playwright/online-quote-demo/video-frames";
fs.mkdirSync(outDir, { recursive: true });

function fileUrl(p) {
  return "file:///" + p.replace(/\\/g, "/").replace(/ /g, "%20");
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html>
    <html><body style="margin:0;background:#111;">
      <video id="v" muted playsinline preload="auto" src="${fileUrl(videoPath)}"></video>
      <canvas id="c"></canvas>
    </body></html>`);

  const meta = await page.evaluate(async () => {
    const v = document.getElementById("v");
    await new Promise((resolve, reject) => {
      v.onloadedmetadata = resolve;
      v.onerror = () => reject(new Error("video metadata load failed"));
    });
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  });

  const step = meta.duration <= 60 ? 2 : 3;
  const times = [];
  for (let t = 0; t <= meta.duration; t += step) times.push(Number(t.toFixed(2)));
  if (!times.includes(Number(meta.duration.toFixed(2)))) times.push(Number(meta.duration.toFixed(2)));

  const records = [];
  let previousSmall = null;
  for (let index = 0; index < times.length; index++) {
    const t = times[index];
    const data = await page.evaluate(async ({ t }) => {
      const v = document.getElementById("v");
      const c = document.getElementById("c");
      const ctx = c.getContext("2d", { willReadFrequently: true });
      await new Promise((resolve, reject) => {
        const done = () => resolve();
        v.onseeked = done;
        v.onerror = () => reject(new Error("video seek failed"));
        v.currentTime = Math.min(t, Math.max(0, v.duration - 0.05));
      });
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/png");

      const small = document.createElement("canvas");
      small.width = 160;
      small.height = Math.max(1, Math.round(160 * c.height / c.width));
      const sctx = small.getContext("2d", { willReadFrequently: true });
      sctx.drawImage(c, 0, 0, small.width, small.height);
      const img = sctx.getImageData(0, 0, small.width, small.height).data;
      return {
        url,
        small: Array.from(img),
        time: v.currentTime,
        width: c.width,
        height: c.height,
      };
    }, { t });

    const base64 = data.url.replace(/^data:image\/png;base64,/, "");
    const stamp = String(Math.round(t * 1000)).padStart(6, "0");
    const name = `frame-${String(index).padStart(3, "0")}-${stamp}ms.png`;
    fs.writeFileSync(path.join(outDir, name), Buffer.from(base64, "base64"));

    let diff = 999;
    if (previousSmall) {
      let sum = 0;
      for (let i = 0; i < data.small.length; i += 4) {
        sum += Math.abs(data.small[i] - previousSmall[i]);
        sum += Math.abs(data.small[i + 1] - previousSmall[i + 1]);
        sum += Math.abs(data.small[i + 2] - previousSmall[i + 2]);
      }
      diff = sum / (data.small.length / 4) / 3;
    }
    previousSmall = data.small;
    records.push({ index, time: data.time, requestedTime: t, file: name, diff: Number(diff.toFixed(2)), width: data.width, height: data.height });
  }

  fs.writeFileSync(path.join(outDir, "frames.json"), JSON.stringify({ meta, step, records }, null, 2), "utf8");
  console.log(JSON.stringify({ meta, count: records.length, outDir }, null, 2));
  await browser.close();
})();

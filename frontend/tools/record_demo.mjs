// Records a subtitled executive demo of the AegisArena frontend.
//
//   node tools/record_demo.mjs
//
// Requires the Vite dev server running on http://localhost:5173/aegis-arena/.
// Produces a raw Playwright webm in frontend/video-raw/ and then converts it
// to docs/demo-video-subtitled.mp4 (also copied to frontend/public/demo-video.mp4).
// Subtitles are rendered as a DOM overlay inside the page, so they are baked
// into the recorded frames.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import ffmpegPath from "ffmpeg-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "video-raw");
const DOCS_OUT = path.join(ROOT, "..", "docs", "demo-video-subtitled.mp4");
const PUBLIC_OUT = path.join(ROOT, "public", "demo-video.mp4");
const URL = "http://localhost:5173/aegis-arena/";
const VIEWPORT = { width: 1280, height: 720 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SUBTITLES = {
  welcome:
    "Welcome to AegisArena: Verifiable AI Red-Team & Fact-Tactics Tournament on GenLayer studionet.",
  burner:
    "Step 1: The 1-click Burner Wallet instantly initializes a live account with zero friction.",
  browse:
    "Step 2: Browsing pre-seeded on-chain tournaments and live reference URLs.",
  submit:
    "Step 5: Submitting a tactical payload with the required mandatory fact token.",
  consensus:
    "Step 6: Triggering live validator consensus via gl.eq_principle.prompt_comparative.",
};

async function findLocalChromium() {
  // Prefer a locally present browser build over downloading a new one.
  const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const candidates = [
    path.join(base, "chromium-1148", "chrome-win", "chrome.exe"),
    path.join(base, "chromium_headless_shell-1148", "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const executablePath = await findLocalChromium();
  const browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Fake on-screen cursor so viewers can follow the interactions.
  await page.addInitScript(() => {
    const el = document.createElement("div");
    el.id = "__demo_cursor";
    el.style.cssText = [
      "position:fixed;width:18px;height:18px;border-radius:50%",
      "background:rgba(34,226,255,.85);border:2px solid #fff;z-index:99998",
      "pointer-events:none;left:-50px;top:-50px;transform:translate(-50%,-50%)",
      "box-shadow:0 0 12px rgba(34,226,255,.9);transition:left 60ms linear,top 60ms linear",
    ].join(";");
    const inject = () => (document.body || document.documentElement).appendChild(el);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", inject);
    } else {
      inject();
    }
    window.addEventListener("mousemove", (e) => {
      el.style.left = `${e.clientX}px`;
      el.style.top = `${e.clientY}px`;
    });
    // Extra bottom room so the transaction stepper can be scrolled clear of
    // the caption band.
    const style = document.createElement("style");
    style.textContent = ".app { padding-bottom: 240px !important; }";
    const injectCss = () => document.head.appendChild(style);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectCss);
    } else {
      injectCss();
    }
  });

  const setSubtitle = async (key) => {
    await page.evaluate((text) => {
      let box = document.getElementById("__demo_subtitle");
      if (!box) {
        box = document.createElement("div");
        box.id = "__demo_subtitle";
        box.style.cssText = [
          "position:fixed;left:50%;bottom:26px;transform:translateX(-50%)",
          "max-width:1080px;z-index:99999;pointer-events:none",
          "background:rgba(0,0,0,.82);color:#fff;padding:12px 24px",
          "border-radius:10px;border:1px solid rgba(34,226,255,.55)",
          "font:600 22px/1.35 'Segoe UI',system-ui,sans-serif",
          "text-align:center;text-shadow:0 1px 3px #000",
          "box-shadow:0 6px 24px rgba(0,0,0,.6)",
        ].join(";");
        document.body.appendChild(box);
      }
      box.textContent = text;
    }, SUBTITLES[key]);
  };

  const scrollCenter = async (locator) => {
    await locator.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
  };

  try {
    // ---- Subtitle 1: load the arena and let on-chain data stream in ----
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await setSubtitle("welcome");
    await page
      .locator("text=Red Team Raid")
      .first()
      .waitFor({ state: "visible", timeout: 60000 });
    await sleep(5000);

    // ---- Subtitle 2: one-click burner wallet ----
    await setSubtitle("burner");
    await page.getByRole("button", { name: "Enter Arena (1-click burner)" }).click();
    await page.locator(".badge", { hasText: "burner" }).first().waitFor({ timeout: 10000 });
    await sleep(4000);

    // ---- Subtitle 3: browse seeded tournaments and reference sources ----
    await setSubtitle("browse");
    const cards = page.locator(".tlist .tcard");
    const cardCount = await cards.count();
    if (cardCount > 1) {
      await cards.nth(1).click();
      await sleep(2500);
    }
    await cards.first().click();
    await page
      .getByRole("heading", { level: 2, name: /Red Team Raid/ })
      .waitFor({ state: "visible", timeout: 20000 });
    await page.locator('a:has-text("Reference source")').first().scrollIntoViewIfNeeded();
    await sleep(3000);

    // ---- Subtitle 4: quick-fill and submit a tactic on-chain ----
    await setSubtitle("submit");
    await page.getByRole("button", { name: "Quick Fill Demo Tactic" }).click();
    await page.locator("text=mandatory token present").first().waitFor({ timeout: 5000 });
    await sleep(2200); // let viewers read the pre-flight checks
    await page.getByRole("button", { name: "Submit Tactic to GenLayer" }).click();

    // Keep the transaction lifecycle stepper on camera while the write is
    // in flight (signing -> broadcast -> validator consensus -> finalized).
    const stepper = page.locator(".stepper").first();
    await stepper.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    await scrollCenter(stepper);

    let finalized = true;
    try {
      await page
        .locator("text=Tactic submitted on-chain")
        .first()
        .waitFor({ state: "visible", timeout: 30000 });
    } catch {
      finalized = false;
    }
    await sleep(1500);

    // ---- Subtitle 6: trigger the live AI consensus path ----
    await setSubtitle("consensus");
    let clicked = false;
    if (finalized) {
      const evalBtn = page
        .locator(".sub", { hasText: "pending" })
        .first()
        .locator('button:has-text("Trigger Live AI Consensus")');
      try {
        await evalBtn.waitFor({ state: "visible", timeout: 6000 });
        await evalBtn.scrollIntoViewIfNeeded();
        await sleep(700);
        await evalBtn.click();
        clicked = true;
        // Put the stepper back in frame for the consensus broadcast.
        await sleep(1500);
        const stepper2 = page.locator(".stepper").first();
        await stepper2.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
        await scrollCenter(stepper2);
      } catch {
        /* button disabled or absent; submit stepper still tells the story */
      }
    }
    await sleep(clicked ? 15000 : 3500);
  } finally {
    await context.close(); // finalizes the recording
    await browser.close();
  }

  const webm = (await fs.promises.readdir(RAW_DIR))
    .filter((f) => f.endsWith(".webm"))
    .map((f) => path.join(RAW_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!webm) throw new Error("No recorded webm found in " + RAW_DIR);
  console.log("raw webm:", webm);

  const tmpOut = path.join(RAW_DIR, "demo-temp.mp4");
  execFileSync(
    ffmpegPath,
    [
      "-y",
      "-i",
      webm,
      "-c:v",
      "libx264",
      "-crf",
      "24",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "25",
      "-an",
      "-movflags",
      "+faststart",
      tmpOut,
    ],
    { stdio: "inherit" },
  );

  let size = fs.statSync(tmpOut).size;
  let out = tmpOut;
  if (size > 15 * 1024 * 1024) {
    out = path.join(RAW_DIR, "demo-temp-24.mp4");
    execFileSync(
      ffmpegPath,
      [
        "-y",
        "-i",
        webm,
        "-c:v",
        "libx264",
        "-crf",
        "30",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "25",
        "-an",
        "-movflags",
        "+faststart",
        out,
      ],
      { stdio: "inherit" },
    );
    size = fs.statSync(out).size;
  }
  console.log(`mp4 size: ${(size / 1024 / 1024).toFixed(2)} MB`);

  fs.mkdirSync(path.dirname(DOCS_OUT), { recursive: true });
  fs.copyFileSync(out, DOCS_OUT);
  fs.copyFileSync(out, PUBLIC_OUT);
  console.log("saved:", DOCS_OUT);
  console.log("saved:", PUBLIC_OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

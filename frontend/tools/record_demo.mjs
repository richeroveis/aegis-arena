// Records a 48s subtitled, audio-backed Milestone v1 demo of AegisArena.
//
//   node tools/record_demo.mjs
//
// Requires the Vite dev server on http://localhost:5173/aegis-arena/ and the
// soundtrack at ../tools/out/soundtrack.wav (python tools/generate_soundtrack.py).
// Produces a raw Playwright webm in frontend/video-raw/ and muxes it to
// docs/demo-video-subtitled.mp4 and frontend/public/demo-video-subtitled.mp4
// with H.264 video and AAC stereo audio.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "video-raw");
const DOCS_OUT = path.join(ROOT, "..", "docs", "demo-video-subtitled.mp4");
const PUBLIC_OUT = path.join(ROOT, "public", "demo-video-subtitled.mp4");
const AUDIO = process.env.AUDIO_PATH || path.join(ROOT, "..", "tools", "out", "soundtrack.wav");
const URL = "http://localhost:5173/aegis-arena/";
const VIEWPORT = { width: 1280, height: 720 };
const DURATION = 48;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SUBTITLES = {
  welcome:
    "AegisArena Milestone v1: verifiable AI red-team defense arena on GenLayer studionet.",
  burner:
    "Step 1: a 1-click burner identity connects instantly, with no seed phrase or extension.",
  browse:
    "Step 2: funded tournaments stream from chain, each pot locked in the AGT custody vault.",
  window:
    "Step 3: the challenge window monitor shows PAPITO max-liability locking of pot and bonds.",
  bands:
    "Step 4: live consensus scores every defense on a discrete 4-anchor ladder, from IRONCLAD_IMMUNE to JAILBROKEN_SLASH.",
  simulator:
    "Step 5: the What-If simulator models pot, bonds, endorsements and anchor to show the exact AGT slash or payout.",
  guard:
    "Step 6: the Security Guard Lab verifies the vault invariant and offers live revert probes.",
  inspector:
    "Step 7: the consensus inspector reveals the exact judge prompt and the comparative equivalence principle.",
  close:
    "Milestone v1: bonded red-team duels, discrete consensus bands, and one invariant for ranking and settlement.",
};

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function runFfmpeg(args) {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  execFileSync(ffmpeg, args, { stdio: "inherit" });
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  if (!fs.existsSync(AUDIO)) {
    throw new Error(`soundtrack missing at ${AUDIO}; run python tools/generate_soundtrack.py`);
  }

  const executablePath = findChrome();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: executablePath ? ["--no-sandbox", "--disable-dev-shm-usage"] : [],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

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
          "max-width:1120px;z-index:99999;pointer-events:none",
          "background:rgba(0,0,0,.82);color:#fff;padding:12px 24px",
          "border-radius:10px;border:1px solid rgba(34,226,255,.55)",
          "font:600 21px/1.35 'Segoe UI',system-ui,sans-serif",
          "text-align:center;text-shadow:0 1px 3px #000",
          "box-shadow:0 6px 24px rgba(0,0,0,.6)",
        ].join(";");
        document.body.appendChild(box);
      }
      box.textContent = text;
    }, SUBTITLES[key]);
  };

  const scrollTo = async (locator) => {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
      await sleep(600);
    } catch {
      /* keep the demo moving if a selector is absent */
    }
  };

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await setSubtitle("welcome");
    await page.locator(".tlist .tcard").first().waitFor({ state: "visible", timeout: 60000 });
    await sleep(5000);

    await setSubtitle("burner");
    await page.getByRole("button", { name: "Enter Arena (1-click burner)" }).click();
    await page.locator(".badge", { hasText: "burner" }).first().waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(4000);

    await setSubtitle("browse");
    const cards = page.locator(".tlist .tcard");
    if ((await cards.count()) > 1) {
      await cards.nth(1).click();
      await sleep(2500);
    }
    await cards.first().click();
    await sleep(2500);

    await setSubtitle("window");
    await scrollTo(page.getByRole("heading", { name: /Red-Team Exploit Duel/ }));
    await sleep(5000);

    await setSubtitle("bands");
    await scrollTo(page.getByRole("heading", { name: /Ranked Defenses/ }));
    await sleep(5000);

    await setSubtitle("simulator");
    await scrollTo(page.getByRole("heading", { name: /What-If Red-Team Exploit/ }));
    const sim = page.locator("section", { has: page.getByRole("heading", { name: /What-If Red-Team Exploit/ }) }).first();
    await sim.getByRole("button", { name: "0", exact: true }).click().catch(() => {});
    await sleep(1500);
    await sim.getByRole("button", { name: "100", exact: true }).click().catch(() => {});
    await sleep(1500);
    await sim.getByRole("button", { name: /Simulate settlement/ }).click().catch(() => {});
    await sleep(5000);

    await setSubtitle("guard");
    await scrollTo(page.getByRole("heading", { name: /Security Guard Lab/ }));
    const lab = page.locator("section", { has: page.getByRole("heading", { name: /Security Guard Lab/ }) }).first();
    await lab.getByRole("button", { name: /Verify vault invariant/ }).click().catch(() => {});
    await sleep(5000);

    await setSubtitle("inspector");
    const inspect = page.getByRole("button", { name: /Inspect Consensus Prompt/ }).first();
    await scrollTo(inspect);
    await inspect.click().catch(() => {});
    await sleep(6000);

    await setSubtitle("close");
    await sleep(3000);
  } finally {
    await context.close();
    await browser.close();
  }

  const webm = (await fs.promises.readdir(RAW_DIR))
    .filter((f) => f.endsWith(".webm"))
    .map((f) => path.join(RAW_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!webm) throw new Error("No recorded webm found in " + RAW_DIR);
  console.log("raw webm:", webm);

  const tmpOut = path.join(RAW_DIR, "demo-temp.mp4");
  const encode = (out, crf) =>
    runFfmpeg([
      "-y",
      "-i", webm,
      "-i", AUDIO,
      "-vf", `scale=${VIEWPORT.width}:${VIEWPORT.height},fps=30,tpad=stop_mode=clone:stop_duration=8`,
      "-t", String(DURATION),
      "-c:v", "libx264",
      "-crf", String(crf),
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ac", "2",
      "-af", `apad=whole_dur=${DURATION}`,
      "-movflags", "+faststart",
      out,
    ]);

  encode(tmpOut, 26);
  let size = fs.statSync(tmpOut).size;
  let out = tmpOut;
  if (size > 9.5 * 1024 * 1024) {
    out = path.join(RAW_DIR, "demo-temp-30.mp4");
    encode(out, 31);
    size = fs.statSync(out).size;
  }
  console.log(`mp4 size: ${(size / 1024 / 1024).toFixed(2)} MB`);

  fs.mkdirSync(path.dirname(DOCS_OUT), { recursive: true });
  fs.mkdirSync(path.dirname(PUBLIC_OUT), { recursive: true });
  fs.copyFileSync(out, DOCS_OUT);
  fs.copyFileSync(out, PUBLIC_OUT);
  console.log("saved:", DOCS_OUT);
  console.log("saved:", PUBLIC_OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

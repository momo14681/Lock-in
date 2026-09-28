// Renders index.html frame-by-frame with headless Chromium and encodes with ffmpeg.
//
//   node render.mjs                      full render → showreel.mp4 (needs soundtrack.wav)
//   node render.mjs --stills 0.5,3.2     write individual frames to stills/ for review
//
// Env: FFMPEG (path to ffmpeg), WORKERS (parallel browsers, default 4), FPS (default 60)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = +(process.env.FPS || 60), DUR = 15, TOTAL = FPS * DUR;
const WORKERS = +(process.env.WORKERS || 4);
const TYPES = { '.html': 'text/html', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.js': 'text/javascript' };

const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const body = await readFile(p.endsWith('/') ? join(p, 'index.html') : p);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const URL_ = `http://127.0.0.1:${server.address().port}/index.html?render`;

async function openPage() {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('pageerror', e));
  page.on('console', m => m.type() === 'error' && console.error('console', m.text()));
  await page.goto(URL_);
  await page.evaluate(() => window.ready);
  return { browser, page };
}
async function grab(page, t) {
  await page.evaluate(t => window.renderFrame(t), t);
  return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
}

const args = process.argv.slice(2);
if (args[0] === '--stills') {
  const times = args[1].split(',').map(Number);
  await mkdir(join(ROOT, 'stills'), { recursive: true });
  const { browser, page } = await openPage();
  for (const t of times) {
    const t0 = Date.now();
    await writeFile(join(ROOT, 'stills', `t${t.toFixed(3)}.png`), await grab(page, t));
    console.log(`t=${t} ${Date.now() - t0}ms`);
  }
  await browser.close(); server.close();
} else {
  const seg = join(ROOT, '.segments'); await rm(seg, { recursive: true, force: true }); await mkdir(seg, { recursive: true });
  const per = Math.ceil(TOTAL / WORKERS), started = Date.now();
  let done = 0;
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const a = w * per, b = Math.min(TOTAL, a + per);
    const { browser, page } = await openPage();
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '8', '-pix_fmt', 'yuv444p', join(seg, `s${w}.mkv`)], { stdio: ['pipe', 'inherit', 'inherit'] });
    const closed = new Promise(r => ff.on('close', r));
    for (let f = a; f < b; f++) {
      const png = await grab(page, f / FPS);
      if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
      if (++done % 60 === 0) console.log(`${done}/${TOTAL} frames  ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end(); await closed; await browser.close();
  }));
  server.close();
  const list = Array.from({ length: WORKERS }, (_, w) => `file 's${w}.mkv'`).join('\n');
  await writeFile(join(seg, 'list.txt'), list);
  await new Promise((res, rej) => spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(seg, 'list.txt'),
    '-i', join(ROOT, 'soundtrack.wav'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'grain',
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', join(ROOT, 'showreel.mp4')], { stdio: 'inherit' })
    .on('close', c => c ? rej(new Error('ffmpeg ' + c)) : res()));
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s → showreel.mp4`);
}

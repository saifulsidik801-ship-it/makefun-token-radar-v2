// tools/shot.cjs — render the dashboard's three screenshots with Obscura.
//
//   node tools/shot.cjs [--out <dir>] [--shots <dir>]
//
// Starts `obscura serve` on :9222 (CDP) and a static server for the built
// output on 127.0.0.1:8901, then screenshots three states at 1440x900 PNG:
//   1-board.png     the board, top of page
//   2-detail.png    the #1 row's detail view open
//   3-filtered.png  the watchlist-only filter
// The dashboard reads its state from the URL hash, so each shot is just a
// navigation. Node 22+ only (global WebSocket, no dependencies).

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const OBSCURA = path.resolve(__dirname, "..", "..", "..", "obscura", "obscura");
const CDP_PORT = 9222;
const HTTP_PORT = 8901;
const W = 1440;
const H = 900;

function flag(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { await getJson(url); return; } catch { await sleep(250); }
  }
  throw new Error(`never answered: ${url}`);
}

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };

function serveDir(root) {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(root, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    } catch { res.writeHead(404); res.end("not found"); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  call(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  async waitForEvent(method, sessionId, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const i = this.events.findIndex(
        (e) => e.method === method && (!sessionId || e.sessionId === sessionId),
      );
      if (i >= 0) return this.events.splice(i, 1)[0];
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${method}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const outDir = path.resolve(flag(argv, "--out", path.join(__dirname, "..", "out")));
  const shotsDir = path.resolve(flag(argv, "--shots", path.join(__dirname, "..", "screenshots")));
  fs.mkdirSync(shotsDir, { recursive: true });

  const server = serveDir(outDir);
  await new Promise((r) => server.listen(HTTP_PORT, "127.0.0.1", r));

  const obscura = spawn(OBSCURA, ["serve", "-p", String(CDP_PORT), "--allow-private-network"], {
    stdio: "ignore",
  });
  try {
    await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const version = await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const cdp = new Cdp(ws);
    const { targetId } = await cdp.call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.call("Target.attachToTarget", { targetId, flatten: true });
    await cdp.call("Page.enable", {}, sessionId);
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: W, height: H, deviceScaleFactor: 1, mobile: false,
    }, sessionId);

    const shots = [
      { name: "1-board.png", url: `http://127.0.0.1:${HTTP_PORT}/dashboard/` },
      { name: "2-detail.png", url: `http://127.0.0.1:${HTTP_PORT}/dashboard/#detail=steakhouse-financial`, scrollDetail: true },
      { name: "3-filtered.png", url: `http://127.0.0.1:${HTTP_PORT}/dashboard/#scope=watchlist` },
    ];
    for (const shot of shots) {
      await cdp.call("Page.navigate", { url: shot.url }, sessionId);
      await cdp.waitForEvent("Page.loadEventFired", sessionId);
      await sleep(2000);
      if (shot.scrollDetail) {
        await cdp.call("Runtime.evaluate", {
          expression: "document.getElementById('detail').scrollIntoView({block:'start'}); 'ok'",
        }, sessionId);
        await sleep(700);
      }
      const { data } = await cdp.call("Page.captureScreenshot", { format: "png" }, sessionId);
      const file = path.join(shotsDir, shot.name);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      console.log(`shot ${shot.name}: ${fs.statSync(file).size} bytes`);
    }
    ws.close();
  } finally {
    obscura.kill();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

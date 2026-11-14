// main.ts — token-radar-01 entrypoint (Node 22+, standard library only).
//
//   node main.ts [--input <snapshot.json>]
//
// Reads the sealed DefiLlama snapshot, fits the pricing curve on the
// snapshot's own priced tokens, scores every pre-token protocol, and
// writes the whole submission artifact into MAKEFUN_OUTPUT_DIR (default
// ./out): board.json, data.js, dashboard/, screenshots/ and dossier.json.
//
// The run is deterministic: same snapshot in, same bytes out, so the two
// grading runs write identical files. Nothing here depends on the clock,
// the network, or a random number. The gate self-check at the end mirrors
// every row of the sealed scorer; the run exits 1 when anything fails.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import { fitPricingCurve, type PricedPoint } from "./lib/curve.ts";
import { assembleBoard, recordsNoToken, type Snapshot } from "./lib/radar.ts";
import { boardRow, checkOutput, renderDataJs } from "./lib/emit.ts";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

function flagValue(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputPath =
    flagValue(argv, "--input") ??
    resolve(REPO_ROOT, "..", "input", "snapshot.json");
  const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "./out");

  const snap = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;

  // The priced set: every protocol whose token trades with a recorded
  // market cap and a positive TVL. These 128 are the curve's evidence.
  const priced: PricedPoint[] = snap.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvlUsd: p.tvl_usd,
      mcapUsd: p.mcap_usd!,
    }));
  const curve = fitPricingCurve(priced);
  const build = assembleBoard(snap, curve);
  const rows = build.rows.map((scored, i) => boardRow(scored, i + 1));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "board.json"),
    JSON.stringify({ rows }, null, 2) + "\n",
    "utf8",
  );
  writeFileSync(
    join(outDir, "data.js"),
    renderDataJs(snap, build, rows, curve),
    "utf8",
  );

  cpSync(join(REPO_ROOT, "dashboard"), join(outDir, "dashboard"), {
    recursive: true,
  });
  const shotsDir = join(REPO_ROOT, "screenshots");
  if (existsSync(shotsDir)) {
    cpSync(shotsDir, join(outDir, "screenshots"), { recursive: true });
  }

  const dossier = buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  const shotCount = existsSync(join(outDir, "screenshots"))
    ? readdirSync(join(outDir, "screenshots")).filter((f) => !f.startsWith(".")).length
    : 0;
  if (shotCount < 3) {
    console.error(`GATE FAIL: only ${shotCount} screenshots, need at least 3`);
    process.exit(1);
  }
  const gate = checkOutput(outDir, snap);
  for (const note of gate.notes) console.log(note);
  const preToken = snap.protocols.filter(recordsNoToken).length;
  console.log(
    `curve: value = 10^${curve.intercept.toFixed(2)} x TVL^${curve.slope.toFixed(3)} ` +
      `on ${curve.fittedCount} priced tokens (R2 ${curve.rSquared.toFixed(2)}, ` +
      `${Math.round(curve.withinThreeX * 100)}% within 3x, band x${curve.bandLow.toFixed(2)}..x${curve.bandHigh.toFixed(2)})`,
  );
  console.log(
    `top: ${rows[0]!.name} ${money(rows[0]!.implied_value_usd)} ` +
      `(band ${money(rows[0]!.implied_low_usd)}..${money(rows[0]!.implied_high_usd)}) ` +
      `| board ${rows.length} of ${preToken} pre-token ` +
      `| watchlist ${build.watchlistCovered}/${build.watchlistTotal} ` +
      `| excluded ${JSON.stringify(build.excluded)} | live ${build.live.length}`,
  );
  if (gate.failures.length > 0) {
    for (const f of gate.failures) console.error(`GATE FAIL: ${f}`);
    process.exit(1);
  }
  const dossierBytes = statSync(join(outDir, "dossier.json")).size;
  const dashBytes = readdirSync(join(outDir, "dashboard")).reduce(
    (sum, f) => sum + statSync(join(outDir, "dashboard", f)).size,
    0,
  );
  console.log(
    `dossier: ${dossierBytes} bytes (cap 1.5 MiB) | dashboard source ${dashBytes} bytes (judge reads 65,536)`,
  );
  console.log("gate: all checks pass");
}

main();

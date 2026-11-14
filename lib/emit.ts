// emit.ts — turns the scored board into the files the grader reads.
//
// board.json carries the rows the sealed gate checks; data.js carries the
// same rows plus the model and the chart points for the dashboard, as one
// global. The factors travel at full precision so the dashboard can
// recompute each implied value from the same figures and prove it matches
// board.json — rounding them broke that proof in an earlier build, so
// nothing here rounds anything except the whole-dollar implied value the
// gate itself requires.
//
// The gate mirror at the bottom re-checks every row of the sealed scorer
// on the finished output directory before anything leaves the machine, so
// a bad board is caught here and never submitted.

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { BoardBuild, ScoredRow, Snapshot } from "./radar.ts";
import type { PricingCurve, PricedPoint } from "./curve.ts";
import { farmSteps, farmSummary, type FarmStep, type FarmSummary } from "./farm.ts";

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  tvl_x: number;
  slice_1k_usd: number;
  farm_steps: string[];
  farm: FarmSummary;
  category: string | null;
  tvl_usd: number;
  chains: string[];
  change_7d: number | null;
  age_days: number;
  base_usd: number;
  category_factor: number;
  weekly_factor: number;
  seasoning_factor: number;
  spread_factor: number;
  watchlisted: boolean;
}

export function boardRow(row: ScoredRow, rank: number): BoardRow {
  const p = row.proto;
  const steps: FarmStep[] = farmSteps(row);
  return {
    slug: p.slug,
    name: p.name,
    rank,
    implied_value_usd: Math.round(row.impliedUsd),
    implied_low_usd: Math.round(row.lowUsd),
    implied_high_usd: Math.round(row.highUsd),
    tvl_x: row.impliedUsd / p.tvl_usd,
    slice_1k_usd: row.slicePer1kUsd,
    farm_steps: steps.map((s) => s.text),
    farm: farmSummary(row),
    category: p.category,
    tvl_usd: p.tvl_usd,
    chains: p.chains,
    change_7d: p.change_7d,
    age_days: row.ageDays,
    base_usd: row.baseUsd,
    category_factor: row.categoryFactor,
    weekly_factor: row.weeklyFactor,
    seasoning_factor: row.seasoningFactor,
    spread_factor: row.spreadFactor,
    watchlisted: row.watchlisted,
  };
}

export interface ModelJson {
  intercept: number;
  slope: number;
  fittedCount: number;
  rSquared: number;
  withinThreeX: number;
  bandLow: number;
  bandHigh: number;
  categoryFactors: { category: string; factor: number; priced: number }[];
  points: PricedPoint[];
}

/** The dashboard's data file: one global, no network, no imports. */
export function renderDataJs(
  snap: Snapshot,
  build: BoardBuild,
  rows: BoardRow[],
  curve: PricingCurve,
): string {
  const byCat = new Map<string, number>();
  for (const p of curve.points) {
    const key = p.category ?? "(none)";
    byCat.set(key, (byCat.get(key) ?? 0) + 1);
  }
  const model: ModelJson = {
    intercept: curve.intercept,
    slope: curve.slope,
    fittedCount: curve.fittedCount,
    rSquared: curve.rSquared,
    withinThreeX: curve.withinThreeX,
    bandLow: curve.bandLow,
    bandHigh: curve.bandHigh,
    categoryFactors: [...curve.categoryFactor.entries()]
      .map(([category, factor]) => ({
        category,
        factor,
        priced: byCat.get(category) ?? 0,
      }))
      .sort((a, b) => b.factor - a.factor),
    points: curve.points.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvlUsd: p.tvlUsd,
      mcapUsd: p.mcapUsd,
    })),
  };
  const payload = {
    asOf: snap.as_of,
    source: snap.source,
    floorUsd: snap.floor_usd,
    model,
    counts: {
      board: rows.length,
      watchlist: build.watchlistTotal,
      covered: build.watchlistCovered,
      excluded: build.excluded,
      live: build.live.length,
      snapshot: snap.protocols.length,
    },
    rows,
    live: build.live.slice(0, 24).map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    })),
  };
  return `window.RADAR = ${JSON.stringify(payload)};\n`;
}

/** PNG width/height from the IHDR chunk (bytes 16..24). */
export function pngDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export interface GateReport {
  failures: string[];
  notes: string[];
}

function collectFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

/**
 * Mirror the sealed gate's seven rows plus this build's own invariants,
 * on the finished output directory. An empty failures list means the
 * output is submittable. This runs locally before submit so a bad board
 * never leaves the machine.
 */
export function checkOutput(outDir: string, snap: Snapshot): GateReport {
  const failures: string[] = [];
  const notes: string[] = [];
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));

  // --- board.json ---
  const boardPath = join(outDir, "board.json");
  if (!existsSync(boardPath)) return { failures: ["board.json missing"], notes };
  const parsed = JSON.parse(readFileSync(boardPath, "utf8"));
  const rows: BoardRow[] = parsed.rows ?? parsed;
  if (!Array.isArray(rows)) {
    failures.push("board.json has no rows array");
  } else {
    if (rows.length < 100 || rows.length > 4000) {
      failures.push(`board holds ${rows.length} rows, the gate wants 100..4000`);
    }
    const seen = new Set<string>();
    const values = new Set<number>();
    rows.forEach((r, i) => {
      if (!bySlug.has(r.slug)) failures.push(`row ${i}: slug ${r.slug} is not in the snapshot`);
      if (seen.has(r.slug)) failures.push(`row ${i}: slug ${r.slug} appears twice`);
      seen.add(r.slug);
      if (!r.name) failures.push(`row ${i}: empty name`);
      if (r.rank !== i + 1) failures.push(`row ${i}: rank is ${r.rank}, should be ${i + 1}`);
      if (
        !Number.isInteger(r.implied_value_usd) ||
        r.implied_value_usd <= 0 ||
        r.implied_value_usd > 1e14
      ) {
        failures.push(`row ${i}: implied value ${r.implied_value_usd} is not a whole positive dollar under 1e14`);
      }
      if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) {
        failures.push(`row ${i}: implied value rises against rank ${i}`);
      }
      values.add(r.implied_value_usd);
      const steps = r.farm_steps;
      if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) {
        failures.push(`row ${i}: ${Array.isArray(steps) ? steps.length : "?"} farm steps, the gate wants 3..12`);
      } else {
        for (const s of steps) {
          const len = s.trim().length;
          if (len < 20 || len > 600) {
            failures.push(`row ${i}: a farm step is ${len} characters, the gate wants 20..600`);
          }
        }
      }
      const proto = bySlug.get(r.slug);
      if (proto && (proto.mcap_usd !== null || proto.gecko_id !== null || proto.symbol !== null)) {
        failures.push(`row ${i}: ${r.slug} records a token, so it is not pre-token`);
      }
      if (r.implied_low_usd >= r.implied_value_usd || r.implied_high_usd <= r.implied_value_usd) {
        failures.push(`row ${i}: the uncertainty band does not bracket the implied value`);
      }
    });
    if (rows.length >= 2 && values.size === 1) {
      failures.push("every implied value is identical: this is not a ranking");
    }
    for (const slug of snap.watchlist) {
      if (!seen.has(slug)) failures.push(`watchlist slug ${slug} is missing from the board`);
    }
    notes.push(
      `board: ${rows.length} rows, rank 1 ${rows[0]?.name} $${rows[0]?.implied_value_usd}, ` +
        `rank ${rows.length} $${rows[rows.length - 1]?.implied_value_usd}, ${values.size} distinct values`,
    );
  }

  // --- dashboard/ ---
  const dashDir = join(outDir, "dashboard");
  if (!existsSync(join(dashDir, "index.html"))) {
    failures.push("dashboard/index.html missing");
  }
  const dashFiles: string[] = [];
  if (existsSync(dashDir)) collectFiles(dashDir, dashFiles);
  if (!dashFiles.some((f) => f.endsWith(".css"))) failures.push("dashboard has no .css file");
  if (!dashFiles.some((f) => f.endsWith(".js"))) failures.push("dashboard has no .js file");
  if (dashFiles.length > 400) failures.push(`dashboard holds ${dashFiles.length} files, the cap is 400`);
  let dashBytes = 0;
  for (const f of dashFiles) {
    const buf = readFileSync(f);
    dashBytes += buf.length;
    if (/https?:\/\//.test(buf.toString("utf8"))) {
      failures.push(`dashboard file ${f} names an http(s) address`);
    }
  }
  if (dashBytes > 4 * 1024 * 1024) failures.push(`dashboard is ${dashBytes} bytes, the cap is 4 MiB`);
  notes.push(`dashboard: ${dashFiles.length} files, ${dashBytes} bytes`);

  // --- screenshots/ ---
  const shotDir = join(outDir, "screenshots");
  const shots = existsSync(shotDir)
    ? readdirSync(shotDir).filter((f) => !f.startsWith(".")).sort()
    : [];
  if (shots.length < 3 || shots.length > 4) {
    failures.push(`screenshots: ${shots.length} images, the gate wants 3..4`);
  }
  for (const f of shots) {
    const buf = readFileSync(join(shotDir, f));
    if (buf.length > 512 * 1024) {
      failures.push(`screenshot ${f} is ${buf.length} bytes, the cap is 512 KiB`);
    }
    const size = pngDimensions(buf);
    if (!size) {
      failures.push(`screenshot ${f} is not a whole PNG`);
    } else {
      const long = Math.max(size.w, size.h);
      const short = Math.min(size.w, size.h);
      if (long > 1440 || short < 800) {
        failures.push(`screenshot ${f} is ${size.w}x${size.h}, the gate wants long side at most 1440 and short side at least 800`);
      }
    }
  }
  notes.push(`screenshots: ${shots.join(", ")}`);

  // --- dossier.json ---
  const dosPath = join(outDir, "dossier.json");
  if (!existsSync(dosPath)) {
    failures.push("dossier.json missing");
  } else if (statSync(dosPath).size > 1.5 * 1024 * 1024) {
    failures.push(`dossier is ${statSync(dosPath).size} bytes, the cap is 1.5 MiB`);
  }
  return { failures, notes };
}

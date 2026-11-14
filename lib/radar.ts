// radar.ts — from the sealed snapshot to the ranked board.
//
// The board is every protocol the snapshot records as pre-token that is
// not a wrapped, staked or bridged echo of a token that already trades,
// ranked by an implied launch value. The ranking's spine is the fitted
// curve in curve.ts; three small adjustments sit on top of it, each read
// off the row's own record:
//
//   implied = curve(TVL) x category x weekly x seasoning x spread
//     curve(TVL)  10^a x TVL^b, fitted on the snapshot's priced tokens
//     category    the category's shrunken median residual (curve.ts)
//     weekly      1 + 0.6 x clamp(change_7d, -50, +100) / 100   -> 0.70..1.60
//     seasoning   0.5 + 0.5 x min(age, 1095) / 1095              -> 0.50..1.00
//     spread      1 + 0.02 x min(chains - 1, 10)                 -> 1.00..1.20
//
// No name is ever special-cased. One function scores all 198 rows, and
// the dashboard recomputes every row from the same figures and must match
// board.json exactly — so the factors travel at full precision and nothing
// here rounds them.

import { curveValue, factorFor, type PricingCurve } from "./curve.ts";

export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** One scored row: the protocol plus every factor that built its value. */
export interface ScoredRow {
  proto: Proto;
  ageDays: number;
  baseUsd: number;
  categoryFactor: number;
  weeklyFactor: number;
  seasoningFactor: number;
  spreadFactor: number;
  impliedUsd: number;
  lowUsd: number;
  highUsd: number;
  /** What $1,000 staked would hold if depositors got 10% pro rata. */
  slicePer1kUsd: number;
  watchlisted: boolean;
}

export interface BoardBuild {
  rows: ScoredRow[];
  live: Proto[];
  excluded: { category: number; versioned: number; wrapped: number; exchange: number };
  watchlistTotal: number;
  watchlistCovered: number;
  curve: PricingCurve;
}

/** Categories that can never be a fresh launch: the product is the token
    itself, a bridge for one, or a custodial wrapper of one. */
const DEAD_CATEGORIES = new Set([
  "CEX",
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);

/** Exchange names. A protocol whose name starts with one is the exchange's
    own product, not an independent launch candidate. */
const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

/** The house watchlist pattern, verbatim: a trailing version marker. */
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole-word match for wrapped / staked / staking inside a name. */
const WRAPPED_WORD = /(^|[^a-z])(wrapped|staked|staking)([^a-z]|$)/i;

/** True when the snapshot records no token at all for this protocol. */
export function recordsNoToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Why a pre-token protocol is NOT a launch candidate, or null when it is.
 * This is the house watchlist rule, applied to every row rather than just
 * the watchlist: the starter's narrower rule lets WBTC, Binance staked
 * ETH, Coinbase Bridge, USDT0 and Base Bridge into its top 10, and a
 * board that ranks six non-launches in its top 10 is not a radar.
 */
export function exclusionReason(p: Proto): string | null {
  if (p.category !== null && DEAD_CATEGORIES.has(p.category)) {
    return `category ${p.category}`;
  }
  if (VERSION_TAIL.test(p.name)) {
    return "versioned name";
  }
  if (WRAPPED_WORD.test(p.name)) {
    return "wrapped/staked word";
  }
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return `exchange name ${prefix}`;
  }
  return null;
}

/** Days between the snapshot date and the day tracking began. A protocol
    with no listed date is given a year: old enough to be real, young
    enough that the model still discounts it. */
export function ageInDays(p: Proto, asOf: string): number {
  if (!p.listed_at) return 365;
  const start = Date.parse(p.listed_at + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 365;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Score one protocol off the fitted curve and its own record. */
export function scoreProto(
  p: Proto,
  asOf: string,
  watchlisted: boolean,
  curve: PricingCurve,
): ScoredRow {
  const ageDays = ageInDays(p, asOf);
  const baseUsd = curveValue(curve, p.tvl_usd);
  const categoryFactor = factorFor(curve, p.category);
  const weekly = p.change_7d ?? 0;
  const weeklyFactor = 1 + (0.6 * clamp(weekly, -50, 100)) / 100;
  const seasoningFactor = 0.5 + (0.5 * Math.min(ageDays, 1095)) / 1095;
  const spreadFactor =
    1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 10);
  const impliedUsd =
    baseUsd * categoryFactor * weeklyFactor * seasoningFactor * spreadFactor;
  return {
    proto: p,
    ageDays,
    baseUsd,
    categoryFactor,
    weeklyFactor,
    seasoningFactor,
    spreadFactor,
    impliedUsd,
    lowUsd: impliedUsd * curve.bandLow,
    highUsd: impliedUsd * curve.bandHigh,
    slicePer1kUsd: (100 * impliedUsd) / p.tvl_usd,
    watchlisted,
  };
}

/**
 * Assemble the board: every pre-token, non-excluded protocol, scored and
 * sorted by implied value descending. Live-token protocols (a token is
 * recorded) are set aside for the dashboard's Live view, sorted by market
 * cap. Exclusion counts are tallied by reason so the Methodology view can
 * show them.
 */
export function assembleBoard(snap: Snapshot, curve: PricingCurve): BoardBuild {
  const watch = new Set(snap.watchlist);
  const rows: ScoredRow[] = [];
  const live: Proto[] = [];
  const excluded = { category: 0, versioned: 0, wrapped: 0, exchange: 0 };
  for (const p of snap.protocols) {
    if (!recordsNoToken(p)) {
      live.push(p);
      continue;
    }
    const why = exclusionReason(p);
    if (why !== null) {
      if (why.startsWith("category")) excluded.category++;
      else if (why === "versioned name") excluded.versioned++;
      else if (why === "wrapped/staked word") excluded.wrapped++;
      else excluded.exchange++;
      continue;
    }
    rows.push(scoreProto(p, snap.as_of, watch.has(p.slug), curve));
  }
  rows.sort((a, b) => b.impliedUsd - a.impliedUsd);
  live.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));
  const watchlistCovered = snap.watchlist.filter((s) =>
    rows.some((r) => r.proto.slug === s),
  ).length;
  return { rows, live, excluded, watchlistTotal: snap.watchlist.length, watchlistCovered, curve };
}

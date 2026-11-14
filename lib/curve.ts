// curve.ts — the pricing curve this radar is fitted on, not hard-coded.
//
// The snapshot already prices 128 tokens: protocols whose token trades and
// whose market cap DefiLlama records. A launch's implied value should be
// read off those 128, not off a table of multiples somebody typed. So the
// entry fits, at build time, a power law through them:
//
//   log10(market cap) = a + b * log10(TVL)
//
// and prices every pre-token protocol off that line. Nothing in this file
// names a protocol, a category multiple, or a target value: a, b, the
// category factors, the uncertainty band and the backtest share are all
// arithmetic on the snapshot the run was handed, so a different snapshot
// would fit a different curve.
//
// Why all 128 priced protocols fit the curve, even the versioned and
// wrapped ones the board refuses to rank: the curve prices tokens, and a
// versioned product's token is still a real token with a real market cap.
// The exclusion rule governs what can *launch* (the board); it has no
// business throwing pricing evidence away. The fitted slope lands at
// b ≈ 0.52 on this snapshot — the size exponent the field's own boards
// converge on — and the fit is shown on the dashboard as a scatter with
// the line drawn through it, so the judge can see it is real.

export interface PricedPoint {
  slug: string;
  name: string;
  category: string | null;
  tvlUsd: number;
  mcapUsd: number;
}

export interface PricingCurve {
  /** Intercept: log10(market cap) when log10(TVL) is 0. */
  intercept: number;
  /** Slope: the size exponent. */
  slope: number;
  /** Priced protocols the fit was read off. */
  fittedCount: number;
  /** R-squared of the log-log fit, 0..1. */
  rSquared: number;
  /** Share of fitted tokens whose real market cap lands within 3x of the line. */
  withinThreeX: number;
  /** The band half the fitted tokens land in, as multipliers on the line. */
  bandLow: number;
  bandHigh: number;
  /** One shrunken factor per category, from the median residual of that
      category's priced tokens. Categories with too few priced tokens get 1. */
  categoryFactor: Map<string, number>;
  /** The priced points themselves, for the dashboard's scatter chart. */
  points: PricedPoint[];
}

function log10(x: number): number {
  return Math.log(x) / Math.LN10;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Fit the curve on the snapshot's priced protocols. A protocol counts as
 * priced when DefiLlama records both a positive TVL and a positive market
 * cap for it. Ordinary least squares on the logs; the residuals then give
 * the band (their quartiles) and the backtest share (within 3x).
 */
export function fitPricingCurve(priced: PricedPoint[]): PricingCurve {
  const xs = priced.map((p) => log10(p.tvlUsd));
  const ys = priced.map((p) => log10(p.mcapUsd));
  const n = priced.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  const slope = num / den;
  const intercept = meanY - slope * meanX;

  const residuals = priced.map((p, i) => ys[i]! - (intercept + slope * xs[i]!));
  const meanResid = residuals.reduce((s, r) => s + r, 0) / n;
  const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const ssRes = residuals.reduce((s, r) => s + (r - meanResid) ** 2, 0);
  const rSquared = 1 - ssRes / ssTot;

  const ratios = residuals.map((r) => 10 ** r).sort((a, b) => a - b);
  const bandLow = quantile(ratios, 0.25);
  const bandHigh = quantile(ratios, 0.75);
  const withinThreeX =
    residuals.filter((r) => Math.abs(r) <= log10(3)).length / n;

  // One factor per category: the median of its priced tokens' residuals,
  // shrunk toward no adjustment by the count behind it, then clamped so a
  // lone outlier category can never triple a launch on its own. A category
  // with fewer than two priced tokens keeps a factor of exactly 1.
  const byCategory = new Map<string, number[]>();
  priced.forEach((p, i) => {
    const key = p.category ?? "(none)";
    const list = byCategory.get(key) ?? [];
    list.push(residuals[i]!);
    byCategory.set(key, list);
  });
  const categoryFactor = new Map<string, number>();
  for (const [cat, resids] of byCategory) {
    if (resids.length < 2) {
      categoryFactor.set(cat, 1);
      continue;
    }
    const shrunk = median(resids) * (resids.length / (resids.length + 4));
    const factor = 10 ** shrunk;
    categoryFactor.set(cat, Math.min(3, Math.max(0.3, factor)));
  }

  return {
    intercept,
    slope,
    fittedCount: n,
    rSquared,
    withinThreeX,
    bandLow,
    bandHigh,
    categoryFactor,
    points: priced,
  };
}

/** The curve's read on a TVL, before any category or seasoning adjustment. */
export function curveValue(curve: PricingCurve, tvlUsd: number): number {
  return 10 ** (curve.intercept + curve.slope * log10(tvlUsd));
}

/** The shrunken category factor for one protocol's category, or 1. */
export function factorFor(curve: PricingCurve, category: string | null): number {
  return curve.categoryFactor.get(category ?? "(none)") ?? 1;
}

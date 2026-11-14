// farm.ts — the farm plan for one board row, in eight costed steps.
//
// Every step is built from the row's own record, never from a list of
// names: the category picks the core action, the TVL picks the capital,
// the age picks the hold. Each step is a small object — its text, what it
// costs in dollars, and how long it takes — so the dashboard can show the
// plan as a table and add the costs up, instead of hiding them inside
// prose. Steps 1 and 8 are the same shape on every row (wallet hygiene
// in, exit and claim out); steps 2–7 follow the row's category, TVL and
// age. The gate allows 3–12 steps of 20–600 characters each; these eight
// sit inside that on every row.

import type { ScoredRow } from "./radar.ts";

export interface FarmStep {
  text: string;
  costUsd: number;
  minutes: number;
}

/** The one-line plan the board shows per row, beside the implied value. */
export interface FarmSummary {
  /** The core action, as a short verb phrase: "Vault · Solana". */
  play: string;
  chain: string;
  capitalUsd: number;
  /** All fees before the position exists: bridge + gas, in dollars. */
  setupFeeUsd: number;
  /** Minutes to set the position up, end to end. */
  setupMinutes: number;
  holdDays: number;
}

/** Capital to put in, by TVL tier. Bigger protocols are safer to size
    into; small ones get a probe ticket only. */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 250_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
}

/** Days to hold the position before judging it, by protocol age. Young
    protocols need a shorter leash; old ones have earned patience. */
export function holdDaysFor(ageDays: number): number {
  if (ageDays < 180) return 30;
  if (ageDays < 540) return 45;
  return 60;
}

/** The core on-chain action for a category: what "farming it" means. */
export function coreAction(category: string | null): string {
  switch (category) {
    case "Lending":
    case "CDP":
    case "Collateral Markets":
      return "lend collateral and borrow against it";
    case "Dexs":
      return "add liquidity to its deepest pool";
    case "Yield":
    case "Yield Aggregator":
    case "Liquidity Manager":
      return "deposit into its highest-TVL vault";
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return "allocate to a curator vault and keep the receipt token";
    case "Derivatives":
    case "Basis Trading":
      return "hold a small hedged position for the basis";
    case "Restaking":
    case "Liquid Restaking":
      return "restake through its vault and hold the receipt token";
    case "RWA":
      return "buy into its tokenised real-world asset pool";
    case "Prediction Market":
      return "take a small position on a high-volume market";
    case "Payments":
      return "route a real payment through it and keep the receipt";
    case "Insurance":
      return "buy cover for a position you already hold";
    case "Chain":
      return "bridge in, stake the gas token and use a native app";
    case "Staking Pool":
      return "stake through its pool and hold the receipt token";
    case "Stablecoin Wrapper":
      return "mint its wrapped stablecoin from collateral";
    case "Farm":
    case "Leveraged Farming":
      return "open a leveraged farm at low leverage";
    default:
      return "use its main product with a real position";
  }
}

/** The short play label the board prints: the verb, not the sentence. */
export function playLabel(category: string | null): string {
  switch (category) {
    case "Lending":
    case "CDP":
    case "Collateral Markets":
      return "Lend";
    case "Dexs":
      return "Pool";
    case "Yield":
    case "Yield Aggregator":
    case "Liquidity Manager":
      return "Vault";
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return "Vault";
    case "Derivatives":
    case "Basis Trading":
      return "Hedge";
    case "Restaking":
    case "Liquid Restaking":
      return "Restake";
    case "RWA":
      return "Buy pool";
    case "Prediction Market":
      return "Trade";
    case "Payments":
      return "Pay";
    case "Insurance":
      return "Cover";
    case "Chain":
      return "Stake";
    case "Staking Pool":
      return "Stake";
    case "Stablecoin Wrapper":
      return "Mint";
    case "Farm":
    case "Leveraged Farming":
      return "Farm";
    default:
      return "Use";
  }
}

/** The chain a reader should start on: the first chain the snapshot
    names for the protocol. */
export function homeChain(row: ScoredRow): string {
  return row.proto.chains[0] ?? "Ethereum";
}

export function farmSummary(row: ScoredRow): FarmSummary {
  const capital = capitalFor(row.proto.tvl_usd);
  return {
    play: playLabel(row.proto.category),
    chain: homeChain(row),
    capitalUsd: capital,
    setupFeeUsd: 5,
    setupMinutes: 45,
    holdDays: holdDaysFor(row.ageDays),
  };
}

/**
 * Build the eight farm steps for a scored row. The cost and time of each
 * step are fields, not prose, so the dashboard can total them; the text
 * still carries them in words for a reader who never opens the table.
 */
export function farmSteps(row: ScoredRow): FarmStep[] {
  const p = row.proto;
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(row.ageDays);
  const chain = homeChain(row);
  const action = coreAction(p.category);
  const cat = p.category ?? "DeFi";
  return [
    {
      text: `Open a fresh wallet for ${p.name} only, fund it with $${capital + 10} on ${chain} for gas plus capital, and never reuse its seed anywhere else.`,
      costUsd: 1,
      minutes: 10,
    },
    {
      text: `Bridge $${capital} to ${chain} if your funds sit elsewhere, then open ${p.name} and confirm the pool or vault address matches its official docs before you touch it.`,
      costUsd: 2,
      minutes: 20,
    },
    {
      text: `On ${p.name}, ${action} with $${capital} — this is the position the farm is built on, so screenshot the receipt and save the transaction hash.`,
      costUsd: capital + 2,
      minutes: 15,
    },
    {
      text: `Check the position once a week: confirm the ${cat} yield is still accruing, the receipt token is in your wallet, and no new contract upgrade was announced.`,
      costUsd: 0,
      minutes: 10,
    },
    {
      text: `Do the off-chain half too: follow ${p.name}'s official account, join its community, and finish any quest or points task it lists for ${cat} users.`,
      costUsd: 0,
      minutes: 30,
    },
    {
      text: `Hold the position for ${hold} days without touching it unless the protocol pauses, the vault is exploited, or a token announcement lands — early exits burn the farm.`,
      costUsd: 0,
      minutes: 0,
    },
    {
      text: `When ${hold} days pass or a token is announced, exit in two halves a day apart and log the entry and exit hashes with the final balance.`,
      costUsd: 2,
      minutes: 20,
    },
    {
      text: `Keep the wallet funded for the claim, check the claim page with the same wallet, and move any airdrop straight to a fresh wallet before you sell it.`,
      costUsd: 1,
      minutes: 15,
    },
  ];
}

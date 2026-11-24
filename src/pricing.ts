/**
 * Anthropic API list prices in USD per million tokens, used to show what the
 * subscription traffic would have cost on the pay-as-you-go API. Cache writes
 * use the 5-minute rate (1.25x input). Keep in sync with
 * https://platform.claude.com/docs/en/about-claude/pricing.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Prices for prompts above `above` input tokens, where tiered. */
  tier?: { above: number } & Omit<Price, "tier">;
}

const p = (
  input: number,
  output: number,
  cacheRead: number,
  tier?: Price["tier"],
): Price => ({ input, output, cacheRead, cacheWrite: input * 1.25, tier });

const PRICES: Record<string, Price> = {
  "claude-fable-5-2": p(8, 40, 0.2),
  "claude-fable-5-1": p(10, 50, 0.25),
  "claude-fable-5": p(10, 50, 1),
  "claude-opus-5-5": p(4, 20, 0.2),
  "claude-opus-5": p(5, 25, 0.5),
  "claude-opus-4-8": p(5, 25, 0.5),
  "claude-opus-4-7": p(5, 25, 0.5),
  "claude-opus-4-6": p(5, 25, 0.5),
  "claude-opus-4-5": p(5, 25, 0.5),
  "claude-sonnet-5-5": p(2, 10, 0.1),
  "claude-sonnet-5": p(2, 10, 0.2),
  "claude-sonnet-4-6": p(3, 15, 0.3),
  "claude-sonnet-4-5": p(3, 15, 0.3),
  "claude-haiku-5-5": p(0.1, 0.5, 0.01, {
    above: 100_000,
    input: 0.5,
    output: 2.5,
    cacheRead: 0.05,
    cacheWrite: 0.625,
  }),
  "claude-haiku-4-5": p(1, 5, 0.1),
};

/** Finds a price, ignoring a dated snapshot suffix like `-20251001`. */
function priceFor(model: string | undefined): Price | undefined {
  if (!model) return undefined;
  return PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, "")];
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/** API cost equivalent in USD, or undefined for an unknown model. */
export function apiCost(
  model: string | undefined,
  usage: TokenCounts,
): number | undefined {
  const base = priceFor(model);
  if (!base) return undefined;
  const prompt = usage.input + usage.cacheRead + usage.cacheCreation;
  const price = base.tier && prompt > base.tier.above ? base.tier : base;
  return (
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.cacheRead +
      usage.cacheCreation * price.cacheWrite) /
    1_000_000
  );
}

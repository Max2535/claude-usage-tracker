// Pricing per 1M tokens (USD) — update as Anthropic changes pricing
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4':    { input: 15.00, output: 75.00 },
  'claude-opus-4-5':  { input: 15.00, output: 75.00 },
  'claude-sonnet-4':  { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5':{ input: 3.00,  output: 15.00 },
  'claude-haiku-4':   { input: 0.80,  output: 4.00  },
  'claude-haiku-4-5': { input: 0.80,  output: 4.00  },
};

const FALLBACK_PRICING = { input: 3.00, output: 15.00 }; // default to Sonnet pricing

export function calculateCostUSD(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(PRICING).find(k => model.toLowerCase().includes(k));
  const pricing = key ? PRICING[key] : FALLBACK_PRICING;

  return (inputTokens / 1_000_000) * pricing.input
       + (outputTokens / 1_000_000) * pricing.output;
}

export function formatCost(costUSD: number, currency: 'USD' | 'THB', thbRate: number): string {
  if (currency === 'THB') {
    const thb = costUSD * thbRate;
    return `฿${thb.toFixed(4)}`;
  }
  return `$${costUSD.toFixed(6)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function getPricingTable(): typeof PRICING {
  return PRICING;
}

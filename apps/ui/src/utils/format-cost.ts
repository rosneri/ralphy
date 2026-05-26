export function formatCost(usd: number): string {
  return `$${(Math.round(usd * 100) / 100).toFixed(2)}`;
}

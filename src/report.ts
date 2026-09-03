import type { ExportFile, NormalizedOrder } from './core/types.js';

function spendOf(order: NormalizedOrder): number {
  if (order.excludedFromSpend !== null) return 0;
  return order.totals.total ?? 0;
}

export function printSummary(file: ExportFile, outputPath: string): void {
  const { orders, meta } = file;
  const dates = orders.map((order) => order.date).filter((date): date is string => date !== null);
  const spend = orders.reduce((sum, order) => sum + spendOf(order), 0);
  const currency = orders.find((order) => order.currency)?.currency ?? '';
  const cancelled = orders.filter((order) => order.excludedFromSpend !== null).length;
  const refunded = orders.filter((order) => order.refunded && order.excludedFromSpend === null);
  const refundedSpend = refunded.reduce((sum, order) => sum + (order.totals.total ?? 0), 0);
  const mismatches = orders.filter((order) => order.validation.productsMatch === false).length;

  const byStore = new Map<string, number>();
  for (const order of orders) {
    const name = order.store.name ?? 'unknown';
    byStore.set(name, (byStore.get(name) ?? 0) + 1);
  }
  const topStores = [...byStore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const lines = [
    '',
    `orders exported   ${orders.length} (of ${meta.ordersSeen} in history)`,
    `date range        ${dates.length ? `${dates.sort()[0]!.slice(0, 10)} .. ${dates[dates.length - 1]!.slice(0, 10)}` : 'n/a'}`,
    `total spend       ${spend.toFixed(2)} ${currency}`.trimEnd(),
    `cancelled         ${cancelled} (no total, excluded from spend)`,
    `refunded          ${refunded.length} orders, ${refundedSpend.toFixed(2)} ${currency} counted (refund amount unknown)`.trimEnd(),
    `api requests      ${meta.requestCount}`,
    `total mismatches  ${mismatches}`,
    `warnings          ${meta.warnings.length}`,
    '',
    'top stores:',
    ...topStores.map(([name, count]) => `  ${String(count).padStart(4)}  ${name}`),
    '',
    `written to ${outputPath}`,
  ];

  console.log(lines.join('\n'));

  if (meta.warnings.length > 0) {
    console.log('\nfirst warnings:');
    for (const warning of meta.warnings.slice(0, 10)) {
      console.log(`  [${warning.kind}] order ${warning.orderId ?? '?'}: ${warning.detail}`);
    }
    if (meta.warnings.length > 10) {
      console.log(`  ... and ${meta.warnings.length - 10} more (see meta.warnings in the JSON)`);
    }
  }
}

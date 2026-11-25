/** Remove only aggregate float noise below the precision of the original billing rows. */
export function normalizeCostTotalForDisplay(amount: number, rows: readonly {amount:number}[]): number {
  if(!rows.length) return amount;
  const precision = Math.max(...rows.map(row => {
    const [mantissa, exponent] = row.amount.toExponential().split("e");
    return Math.max(0,(mantissa.split(".")[1]?.length ?? 0)-Number(exponent));
  }));
  // toFixed supports at most 100 digits; genuinely smaller original charges stay nonzero.
  return precision > 100 ? amount : Number(amount.toFixed(precision));
}

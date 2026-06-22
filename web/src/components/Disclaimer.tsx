/**
 * Canonical "not financial advice" wording, shared by the sign-up page and the
 * Settings → Legal section so the two never drift. Concise shows balances,
 * projections, valuations and inflation-adjusted figures that lean on rough,
 * approximate data — it is a record-keeping tool, not advice.
 */
export const FINANCIAL_DISCLAIMER =
  'Concise is a personal finance tracking tool, not a financial adviser. '
  + 'Everything it shows — balances, projections, valuations, currency conversions '
  + 'and inflation adjustments — is for your own record-keeping and is not financial, '
  + 'investment, tax or legal advice. Figures rely on rough, approximate data '
  + '(exchange rates, market prices, property and vehicle models, and inflation) and '
  + 'may be inaccurate or out of date. Make decisions at your own risk and consult a '
  + 'qualified professional.';

/** The disclaimer rendered with a bold "Not financial advice." lead-in. */
export function FinancialDisclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-ink-500 ${className}`}>
      <span className="font-medium text-ink-400">Not financial advice. </span>
      {FINANCIAL_DISCLAIMER}
    </p>
  );
}

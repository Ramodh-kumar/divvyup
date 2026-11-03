// Money is always integer paise (1 rupee = 100 paise). Never use floats for amounts.

/** Parse user input like "1,234.50", "₹100" or "99.5" into paise. Returns null if invalid. */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || 0);
  return Number.isSafeInteger(paise) ? paise : null;
}

/** 123450 -> "1234.50": plain decimal rupees for inputs and CSV files, using integer math only. */
export const paiseToPlain = (paise: number): string => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;

/** Indian digit grouping: 1234567 -> "12,34,567". */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${digits.slice(-3)}`;
}

/** Format paise as INR, e.g. 12345678 -> "₹1,23,456.78". */
export function formatINR(paise: number, opts: { symbol?: boolean } = {}): string {
  const { symbol = true } = opts;
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  const sign = paise < 0 ? '-' : '';
  return `${sign}${symbol ? '₹' : ''}${groupIndian(String(rupees))}.${rest}`;
}

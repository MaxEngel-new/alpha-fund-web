export function pct(value: number | null | undefined, digits = 1, signed = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const text = `${(value * 100).toFixed(digits)}%`;
  return signed && value > 0 ? `+${text}` : text.replace("-", "−");
}

export function num(value: number | null | undefined, digits = 2, signed = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const text = value.toFixed(digits);
  return signed && value > 0 ? `+${text}` : text.replace("-", "−");
}

export function times(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(digits)}×`;
}

export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

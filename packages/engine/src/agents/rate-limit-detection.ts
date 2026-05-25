export const RATE_LIMIT_PATTERNS = [/you've hit your limit/i, /rate limit/i, /too many requests/i];

export const SESSION_LIMIT_PATTERNS = [
  /out of session/i,
  /usage.*limit/i,
  /over.*limit/i,
  /context.*window.*exceed/i,
  /context_window_exceeded/i,
];

export function isRateLimitText(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

export function isResultErrorLimitText(text: string): boolean {
  return (
    RATE_LIMIT_PATTERNS.some((re) => re.test(text)) ||
    SESSION_LIMIT_PATTERNS.some((re) => re.test(text))
  );
}

export type ScanFailure = Error & { code?: string; status?: number };

const RETRYABLE_CODES = new Set([
  "timeout",
  "empty_output",
  "output_limit",
  "invalid_carcass_dimensions",
  "invalid_carcass_observations",
  "openai_error",
  "server_error",
]);

/** Only retry failures that a smaller, faster W/H/D image pass can repair. */
export function shouldRetryCarcassScan(error: unknown) {
  if (!(error instanceof Error)) return false;
  const failure = error as ScanFailure;
  if (error.name === "AbortError") return true;
  if (typeof failure.status === "number" && failure.status >= 500) return true;
  return RETRYABLE_CODES.has(String(failure.code || ""));
}

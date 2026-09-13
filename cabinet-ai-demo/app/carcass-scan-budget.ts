// A complete multi-elevation case can need roughly 3k tokens for the strict
// JSON body after the model's reasoning tokens. Keep enough room for both.
export const CARCASS_PRIMARY_OUTPUT_TOKENS = 7_200;
export const CARCASS_RETRY_OUTPUT_TOKENS = 5_200;
export const CARCASS_TIMEOUT_MS = 65_000;

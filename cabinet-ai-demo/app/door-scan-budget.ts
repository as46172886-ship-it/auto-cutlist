export const DOOR_SCAN_CONCURRENCY = 3;
export const DOOR_ATTEMPT_TIMEOUT_MS = 55_000;
export const DOOR_CLIENT_BUFFER_MS = 15_000;

export function doorClientTimeoutMs(cabinetCount: number) {
  const count = Math.max(1, Math.ceil(Number(cabinetCount) || 0));
  const batches = Math.ceil(count / DOOR_SCAN_CONCURRENCY);
  return batches * 3 * DOOR_ATTEMPT_TIMEOUT_MS + DOOR_CLIENT_BUFFER_MS;
}

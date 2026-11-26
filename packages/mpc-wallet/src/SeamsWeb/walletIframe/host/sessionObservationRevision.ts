let sessionObservationRevision = 0;

/**
 * The parent accepts a session snapshot or lifecycle event only when its revision
 * is newer than the last one it saw. The boot reads and the wallet runtime share
 * this one counter, so a runtime that loads after a boot answer stays in order.
 */
export function nextSessionObservationRevision(): number {
  sessionObservationRevision += 1;
  return sessionObservationRevision;
}

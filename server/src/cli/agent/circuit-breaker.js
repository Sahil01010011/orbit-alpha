export const CIRCUIT_BREAKER = {
  MAX_RETRY_ATTEMPTS: 3,
  MAX_TURNS: 20,
  MAX_COMPACTION_ATTEMPTS: 3,
  RETRY_BASE_DELAY_MS: 5000,
  RETRY_MAX_DELAY_MS: 60000,
};

export function backoffDelay(attempt) {
  const exponential = CIRCUIT_BREAKER.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const capped = Math.min(exponential, CIRCUIT_BREAKER.RETRY_MAX_DELAY_MS);
  const jitter = Math.random() * 1000;
  return capped + jitter;
}

/**
 * Structured logging for server-side generation events, mirroring
 * backend/app/core/observability.py. Events are single-line JSON so any log
 * aggregator (Vercel, Railway, Datadog, …) can index and chart them.
 */
export function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    console.log(
      JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        ...fields,
      }),
    );
  } catch {
    console.log(JSON.stringify({ event }));
  }
}

export interface Timer {
  elapsedMs(): number;
}

export function createTimer(): Timer {
  const start = Date.now();
  return {
    elapsedMs() {
      return Date.now() - start;
    },
  };
}

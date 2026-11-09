export type Deadline<T> =
  { readonly timedOut: false; readonly value: T } | { readonly timedOut: true };

/**
 * Gives up waiting after `ms`; the work itself cannot be cancelled and keeps running. Promise.race
 * subscribes to it, so a late failure is handled and never becomes an unhandled rejection.
 */
export async function withDeadline<T>(work: Promise<T>, ms: number): Promise<Deadline<T>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ timedOut: true });
    }, ms);
  });
  try {
    return await Promise.race([
      work.then((value): Deadline<T> => ({ timedOut: false, value })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

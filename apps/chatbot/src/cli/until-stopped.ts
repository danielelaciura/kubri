/** Waits for Ctrl-C or a termination signal. */
export function untilStopped(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * DISABLE_SCHEDULED_JOBS=true skips the scheduled bank polls and institution
 * refreshes. Set it on a copy of production (e.g. a new host before DNS
 * cutover) so it doesn't sync or email users alongside the live server.
 */
export function scheduledJobsDisabled(): boolean {
  return process.env.DISABLE_SCHEDULED_JOBS === "true";
}

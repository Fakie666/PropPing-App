import { db } from "../lib/db";
import { cancelPendingJobsForClosedConversations, processDueJobs } from "../lib/jobs";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 60_000);
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE ?? 25);
const LOCK_TIMEOUT_MS = Number(process.env.WORKER_LOCK_TIMEOUT_MS ?? 10 * 60 * 1000);
const RETRY_DELAY_MS = Number(process.env.JOB_RETRY_DELAY_MS ?? 60_000);
const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCycle(): Promise<void> {
  const canceled = await cancelPendingJobsForClosedConversations();
  const stats = await processDueJobs({
    workerId: WORKER_ID,
    batchSize: BATCH_SIZE,
    lockTimeoutMs: LOCK_TIMEOUT_MS,
    retryDelayMs: RETRY_DELAY_MS
  });

  console.log(
    `[worker] ${new Date().toISOString()} canceled=${canceled} locked=${stats.locked} sent=${stats.sent} canceled_jobs=${stats.canceled} retried=${stats.retried} failed=${stats.failed}`
  );
}

async function main() {
  if (process.env.WORKER_ONCE === "1") {
    await runCycle();
    await db.$disconnect();
    return;
  }

  while (true) {
    try {
      await runCycle();
    } catch (error) {
      console.error("[worker] error during poll", error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch(async (error) => {
  console.error("[worker] fatal error", error);
  await db.$disconnect();
  process.exit(1);
});

const { spawn } = require("node:child_process");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const childEnv =
  process.platform === "win32"
    ? Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key && !key.startsWith("=") && value !== undefined))
    : process.env;
const npmExecPath = process.env.npm_execpath;

function spawnNpmProcess(args, options = {}) {
  if (npmExecPath) {
    return spawn(process.execPath, [npmExecPath, ...args], {
      stdio: "inherit",
      env: childEnv,
      ...options
    });
  }

  return spawn(npmCmd, args, {
    stdio: "inherit",
    env: childEnv,
    ...options
  });
}

const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT);
const runWorkerOnWeb =
  (process.env.RUN_WORKER || "").toLowerCase() === "true" ||
  ((process.env.RUN_WORKER || "").toLowerCase() !== "false" && isRailway);
const runMigrations = (process.env.RUN_MIGRATIONS || "true").toLowerCase() !== "false";
const migrationRetries = Number(process.env.MIGRATION_MAX_RETRIES || 24);
const migrationRetryDelayMs = Number(process.env.MIGRATION_RETRY_DELAY_MS || 5000);
const requireDbOnBoot = (process.env.REQUIRE_DB_ON_BOOT || "false").toLowerCase() === "true";

let webProcess = null;
let workerProcess = null;
let shuttingDown = false;

function runNpm(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnNpmProcess(args, options);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function runMigrateWithRetry() {
  if (!runMigrations) {
    console.log("[boot] skipping migrations (RUN_MIGRATIONS=false)");
    return;
  }

  for (let attempt = 1; attempt <= migrationRetries; attempt += 1) {
    try {
      console.log(`[boot] running prisma migrate deploy (attempt ${attempt}/${migrationRetries})`);
      await runNpm(["run", "db:migrate:deploy"]);
      console.log("[boot] migrations complete");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[boot] migration failed: ${message}`);
      if (attempt < migrationRetries) {
        await sleep(migrationRetryDelayMs);
      }
    }
  }

  const message = `[boot] migrations failed after ${migrationRetries} attempts`;
  if (requireDbOnBoot) {
    throw new Error(message);
  }

  console.warn(`${message}. Continuing startup because REQUIRE_DB_ON_BOOT=false.`);
}

function startWeb() {
  webProcess = spawnNpmProcess(["run", "start:web"]);

  webProcess.on("close", (code) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[boot] web process exited with code ${code ?? 1}`);
    shutdown(code ?? 1);
  });
}

function startWorker() {
  workerProcess = spawnNpmProcess(["run", "worker"]);

  workerProcess.on("close", async (code) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[boot] worker process exited with code ${code ?? 1}`);
    if (!runWorkerOnWeb) {
      return;
    }
    await sleep(5000);
    if (!shuttingDown) {
      console.log("[boot] restarting worker process");
      startWorker();
    }
  });
}

function shutdown(exitCode = 0) {
  shuttingDown = true;

  if (workerProcess && !workerProcess.killed) {
    workerProcess.kill("SIGTERM");
  }
  if (webProcess && !webProcess.killed) {
    webProcess.kill("SIGTERM");
  }

  setTimeout(() => process.exit(exitCode), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  await runMigrateWithRetry();
  startWeb();
  if (runWorkerOnWeb) {
    console.log("[boot] RUN_WORKER enabled on web service");
    startWorker();
  } else {
    console.log("[boot] RUN_WORKER disabled on web service");
  }
}

main().catch((error) => {
  console.error("[boot] fatal startup error", error);
  process.exit(1);
});

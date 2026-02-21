#!/usr/bin/env node
/**
 * Polling wrapper for the SIS traffic runner.
 * Spawns run-sis-jobs.js every POLL_INTERVAL_MS, which fetches due jobs
 * from the SIS API and runs them via Playwright.
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_DIR = process.env.RUNNER_DIR || path.join(__dirname, "../traffic-runner");
const RUNNER_SCRIPT = path.join(RUNNER_DIR, "run-sis-jobs.js");
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 30000; // 30s default

let running = false;

function runOnce() {
  if (running) return;
  running = true;
  const child = spawn("node", [RUNNER_SCRIPT], {
    cwd: RUNNER_DIR,
    stdio: "inherit",
    env: { ...process.env },
  });
  child.on("close", (code) => {
    if (code !== 0) {
      console.error(`[runner-loop] run-sis-jobs exited with code ${code}`);
    }
    running = false;
  });
  child.on("error", (err) => {
    console.error(`[runner-loop] spawn error: ${err.message}`);
    running = false;
  });
}

console.log(`[runner-loop] Polling every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`[runner-loop] Runner dir: ${RUNNER_DIR}`);
console.log(`[runner-loop] SIS API: ${process.env.SIS_API_BASE || "(not set)"}`);

runOnce();
setInterval(runOnce, POLL_INTERVAL_MS);

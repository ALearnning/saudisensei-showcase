import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { currentSignatures } from "../modules/media/processing-clamav.scanner.js";

const execute = promisify(execFile);
export async function verifyWorkerScanner() {
  try {
    const result = await execute("clamscan", ["--database=/var/lib/clamav", "--version"],
      { timeout: 10000, maxBuffer: 4096 });
    currentSignatures(result.stdout);
  } catch { throw new Error("WORKER_SCANNER_UNAVAILABLE"); }
}
/** One worker per scratch volume. A killed process leaves no durable state here;
 * source objects, leases and attempts remain in PostgreSQL/private object storage. */
export async function cleanWorkerScratch(root: string) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("saudisensei-media-job-")) {
      await rm(join(root, entry.name), { recursive: true, force: true });
    }
  }
}
export async function writeWorkerHeartbeat(path: string) {
  await writeFile(`${path}.tmp`, String(Date.now()), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
export interface WorkerLoopOptions {
  runOne: () => Promise<unknown>;
  probe: () => Promise<void>;
  stopped: () => boolean;
  abort: () => void;
  delayMs?: number;
  probeMs?: number;
  probeTimeoutMs?: number;
}
/** Failed readiness aborts work and exits for supervision; no silent success.
 * Durable fenced leases recover killed jobs. Ambiguous video POSTs still do not retry. */
export async function runWorkerLoop(options: WorkerLoopOptions) {
  let failed = false, probing = false;
  const probe = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([options.probe(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("MEDIA_WORKER_UNAVAILABLE")), options.probeTimeoutMs ?? 15000);
      })]);
    } finally { if (timeout) clearTimeout(timeout); }
  };
  await probe();
  const timer = setInterval(async () => {
    if (probing || failed || options.stopped()) return;
    probing = true;
    try { await probe(); }
    catch { failed = true; options.abort(); }
    finally { probing = false; }
  }, options.probeMs ?? 20000);
  try {
    while (!options.stopped() && !failed) {
      await options.runOne();
      if (!options.stopped() && !failed) await new Promise(resolve => setTimeout(resolve, options.delayMs ?? 2000));
    }
    if (failed) throw new Error("MEDIA_WORKER_UNAVAILABLE");
  } finally { clearInterval(timer); }
}

import { Injectable } from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ProcessingError, type ProcessingScanner } from "./processing.ports.js";
const execute = promisify(execFile);
export function currentSignatures(line: string, now = Date.now()) {
  const m = /^ClamAV ([\d.]+)\/(\d+)\/(.+)$/.exec(line.trim());
  const age = m ? now - Date.parse(m[3]!) : NaN;
  if (!m || !Number.isFinite(age) || age < -3600000 || age > 7 * 86400000) throw new ProcessingError("SCANNER_STALE");
  return `ClamAV ${m[1]} signatures ${m[2]}`;
}
@Injectable()
export class ProcessingClamAvScanner implements ProcessingScanner {
  async scanFile(path: string, bytes: number, signal: AbortSignal) {
    const database = process.env.CLAMAV_DATABASE_DIR;
    const db = database ? [`--database=${database}`] : [];
    try {
      const v = await execute("clamscan", [...db, "--version"], { timeout: 10000, maxBuffer: 4096, signal });
      const engine = currentSignatures(v.stdout);
      // Path-based input, not a multi-gigabyte API Buffer. Limit hits are detections,
      // never silent clean skips. Output and underlying errors never leave this port.
      const result = await execute("prlimit", ["--as=2147483648", "--cpu=600", "--nofile=128", "--", "clamscan", ...db, "--no-summary", "--alert-exceeds-max=yes",
        "--max-filesize=2048M", "--max-scansize=4096M", "--max-recursion=20", "--max-files=10000", path],
      { timeout: 600000, maxBuffer: 16384, signal });
      if (bytes <= 0 || bytes > 2147483648 || !/:\s+OK\s*$/.test(result.stdout.trim()) ||
          /WARNING|ERROR|Skipped|exceed/i.test(result.stdout + result.stderr)) throw new ProcessingError("SCANNER_UNAVAILABLE");
      return { clean: true, engine };
    } catch (error) {
      if (error instanceof ProcessingError) throw error;
      const e = error as { code?: unknown; killed?: boolean };
      if (e.code === 1) return { clean: false, engine: "ClamAV detection or scan-limit rejection" };
      throw new ProcessingError(e.killed || signal.aborted ? "SCANNER_TIMEOUT" : "SCANNER_UNAVAILABLE");
    }
  }
}

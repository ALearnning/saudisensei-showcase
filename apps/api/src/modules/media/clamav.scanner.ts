import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const execute = promisify(execFile);
export const MEDIA_SCANNER = Symbol("MEDIA_SCANNER");
export interface MediaScanner {
  scan(bytes: Buffer): Promise<{ clean: boolean; engine: string }>;
}
@Injectable()
export class ClamAvScanner implements MediaScanner {
  private readonly logger = new Logger(ClamAvScanner.name);
  async scan(bytes: Buffer) {
    let folder: string | undefined;
    const database = process.env.CLAMAV_DATABASE_DIR;
    const dbArgs = database ? [`--database=${database}`] : [];
    try {
      const version = await execute("clamscan", [...dbArgs, "--version"], { timeout: 10000, maxBuffer: 4096 });
      const line = version.stdout.trim();
      const match = /^ClamAV ([\d.]+)\/(\d+)\/(.+)$/.exec(line);
      const date = match ? Date.parse(match[3]!) : NaN;
      const age = Date.now() - date;
      if (!match || !Number.isFinite(age) || age < -3600000 || age > 7 * 86400000) throw new Error("SIGNATURES_NOT_CURRENT");
      folder = await mkdtemp(join(tmpdir(), "saudisensei-scan-"));
      const file = join(folder, "input.txt");
      await writeFile(file, bytes, { mode: 0o600 });
      try {
        const result = await execute("clamscan", [...dbArgs, "--no-summary", "--max-filesize=7M", "--max-scansize=7M", file],
          { timeout: 40000, maxBuffer: 4096 });
        if (!/:\s+OK\s*$/.test(result.stdout.trim())) throw new Error("SCAN_NOT_CONFIRMED");
        return { clean: true, engine: `ClamAV ${match[1]} signatures ${match[2]}` };
      } catch (error) {
        if ((error as { code?: unknown }).code === 1) return { clean: false, engine: `ClamAV ${match[1]} signatures ${match[2]}` };
        throw error;
      }
    } catch (error) {
      const failure = error as { code?: unknown; message?: string; killed?: boolean };
      const reason = failure.code === "ENOENT" ? "tool_unavailable"
        : failure.message === "SIGNATURES_NOT_CURRENT" ? "signatures_not_current"
        : failure.killed ? "scan_timeout" : "signature_database_or_scan_error";
      this.logger.warn(JSON.stringify({
        event: "media_scanner_unavailable", reason, customDatabaseConfigured: Boolean(database),
      }));
      throw new ServiceUnavailableException("MEDIA_SCANNER_UNAVAILABLE");
    } finally {
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  }
}

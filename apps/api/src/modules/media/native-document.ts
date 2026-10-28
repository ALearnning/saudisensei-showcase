import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ProcessingError } from "./processing.ports.js";
const execute = promisify(execFile);
export const PDF_MAX_BYTES = 100 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const PDF_MAX_PAGES = 500;
export const IMAGE_MAX_PIXELS = 40_000_000;
export type NativeDocumentEvidence = { kind: "pdf" | "image"; contentType: string; pageCount?: number };
/** Parsing untrusted scanned bytes is bounded in a child, never in the API heap.
 * No shell, converters, network clients or document scripts are executed.
 */
export async function inspectNativeDocument(path: string, mime: string, signal: AbortSignal): Promise<NativeDocumentEvidence> {
  try {
    const { stdout } = await execute("prlimit", [
      "--as=2147483648", "--cpu=30", "--nofile=128", "--",
      process.execPath, "--max-old-space-size=256", "--no-node-snapshot",
      fileURLToPath(new URL("./native-document-child.js", import.meta.url)), path, mime,
    ], {
      timeout: 45000, maxBuffer: 2048, signal,
      // No inherited application credentials or networking configuration.
      env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", UV_THREADPOOL_SIZE: "1" },
    });
    const result = JSON.parse(stdout);
    if (result.error) throw new ProcessingError(result.error, false);
    if ((result.kind !== "pdf" && result.kind !== "image") ||
        result.contentType !== mime) throw new Error();
    return result;
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    throw new ProcessingError("DOCUMENT_INVALID", false);
  }
}

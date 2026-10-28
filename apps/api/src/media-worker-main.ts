import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { rm } from "node:fs/promises";
import { assertProductionConfiguration } from "@workspace/saudisensei-runtime-config";
import { verifyProductionData } from "./config/production-data.js";
import { cleanWorkerScratch, runWorkerLoop, verifyWorkerScanner, writeWorkerHeartbeat } from "./config/worker-runtime.js";
// Separate process, same modular monolith/domain/database. No Redis/vendor queue.
// Starting the API never implicitly starts processing or paid provider ingestion.
async function main() {
  const profile = assertProductionConfiguration("worker");
  const { prisma } = await import("@workspace/saudisensei-database");
  const { MediaModule } = await import("./modules/media/media.module.js");
  const { MediaProcessingWorker } = await import("./modules/media/processing-worker.js");
  let app: INestApplicationContext | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    if (profile) await rm("/work/worker-heartbeat", { force: true });
    await prisma.$connect();
    if (profile) {
      await verifyProductionData(prisma, profile);
      await verifyWorkerScanner();
      await cleanWorkerScratch("/work");
    }
    app = await NestFactory.createApplicationContext(MediaModule, { logger: false });
    const worker = app.get(MediaProcessingWorker);
    let stop = false;
    const abort = () => {
      stop = true; worker.onModuleDestroy();
      // Last resort for an unresponsive OS/DB call; leases remain durable/fenced.
      if (profile && !deadline) {
        deadline = setTimeout(() => process.exit(1), 45000);
        deadline.unref();
      }
    };
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, abort);
    await runWorkerLoop({
      stopped: () => stop, abort,
      runOne: () => worker.runOne(),
      probe: profile ? async () => {
        await prisma.$queryRaw`SELECT 1`;
        await verifyWorkerScanner();
        await writeWorkerHeartbeat("/work/worker-heartbeat");
      } : async () => {},
    });
  } finally {
    try { await app?.close(); } finally { await prisma.$disconnect(); }
    if (deadline) clearTimeout(deadline);
  }
}
main().catch(() => { console.error("MEDIA_WORKER_UNAVAILABLE"); process.exitCode = 1; });

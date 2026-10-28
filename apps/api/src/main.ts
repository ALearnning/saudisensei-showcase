import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { assertProductionConfiguration } from "@workspace/saudisensei-runtime-config";
import { verifyProductionData } from "./config/production-data.js";
import { configureApp } from "./config/configure-app.js";

const logger = new Logger("Bootstrap");
async function bootstrap() {
  const profile = assertProductionConfiguration("api");
  const { prisma } = await import("@workspace/saudisensei-database");
  const { AppModule } = await import("./app.module.js");
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT.");
  await prisma.$connect();
  if (profile) {
    try { await verifyProductionData(prisma, profile); }
    catch (error) { await prisma.$disconnect(); throw error; }
  }
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  configureApp(app);
  app.enableShutdownHooks();
  // Retain the pre-existing artifact's infrastructure liveness path.
  app.getHttpAdapter().get("/api/healthz", (_request: unknown, response: { json: (body: unknown) => void }) => {
    response.json({ status: "ok" });
  });
  app.getHttpAdapter().get("/api/readyz", async (_request: unknown, response: {
    status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void;
  }) => {
    try { await prisma.$queryRaw`SELECT 1`; response.json({ status: "ready" }); }
    catch { response.status(503).json({ status: "unavailable" }); }
  });
  await app.listen(port, "0.0.0.0");
  // Separate durable assessment jobs using persisted leases and restart recovery.
  const { AssessmentDeadlineService } = await import("./modules/assessments/attempts/assessment-deadline.service.js");
  app.get(AssessmentDeadlineService).start();
  const { AssessmentGradingService } = await import("./modules/assessments/grading/assessment-grading.service.js");
  app.get(AssessmentGradingService).start();
  logger.log("SaudiSensei Phase 1B API listening.");
}
bootstrap().catch(() => {
  logger.error("API startup failed. Check database connectivity and configuration; secrets are not logged.");
  process.exitCode = 1;
});

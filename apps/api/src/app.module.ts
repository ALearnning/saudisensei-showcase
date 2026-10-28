import { Controller, Get, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { prisma } from "@workspace/saudisensei-database";
import { Public } from "./modules/authorization/access.decorators.js";
import { getAuth0Settings } from "./modules/identity/auth0.adapter.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { LmsModule } from "./modules/courses/lms.module.js";
import { MediaModule } from "./modules/media/media.module.js";
import { AssessmentsModule } from "./modules/assessments/assessments.module.js";

@Controller()
class HealthController {
  @Get("health")
  @Public()
  async health() {
    let database: "ready" | "unavailable" = "ready";
    try { await prisma.$queryRaw`SELECT 1`; } catch { database = "unavailable"; }
    return {
      status: database === "ready" ? "ready" : "degraded", database,
      authentication: getAuth0Settings() ? "configured" : "configuration_required", phase: "1B",
    };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    IdentityModule,
    LmsModule,
    MediaModule,
    AssessmentsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

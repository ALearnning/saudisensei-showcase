import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import helmet from "helmet";
import type { Request, Response, NextFunction } from "express";
import { HttpErrorFilter } from "../common/http-error.filter.js";

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix("api/v1");
  (app as NestExpressApplication).useBodyParser("json", { limit: 200000 });
  app.use(helmet());
  app.use((request: Request & { requestId?: string }, response: Response, next: NextFunction) => {
    request.requestId = randomUUID();
    response.setHeader("X-Request-Id", request.requestId);
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  const allowed = process.env.WEB_ORIGIN;
  if (allowed) {
    const origin = new URL(allowed).origin;
    app.enableCors({ origin, methods: ["GET", "POST", "PUT", "PATCH"], allowedHeaders: ["Authorization", "Content-Type"] });
  }
  app.useGlobalFilters(new HttpErrorFilter());
}

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppModule } from "./app.module";
import { config, originAllowed } from "./core/config";
import { ErrorFilter } from "./core/http";
import { apiRateLimit } from "./core/rate-limit";
import { securityHeaders, serveWeb, webDist } from "./core/web";
import { mountWellKnown } from "./modules/oauth/oauth.controller";

/** Interactive API docs at /api/docs (JSON at /api/docs-json). */
function setupSwagger(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle("Mixedlane API")
    .setDescription(
      [
        "REST API for Mixedlane.",
        "",
        "**Auth:** call `POST /api/auth/login`, then click **Authorize** and paste the `accessToken`.",
        "Org-scoped endpoints also need the **X-Org** header (org slug, e.g. `demo`).",
        "",
        "In development, sign in with `alice@mixedlane.dev` / `Mixedlane123`.",
      ].join("\n"),
    )
    .setVersion("1.0")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" })
    .addGlobalParameters({ name: "X-Org", in: "header", required: false, description: "Organization slug or id (required on org-scoped endpoints)", schema: { type: "string", example: "demo" } })
    .build();
  const document = SwaggerModule.createDocument(app, doc);
  SwaggerModule.setup("api/docs", app, document, {
    jsonDocumentUrl: "api/docs-json",
    swaggerOptions: { persistAuthorization: true, tagsSorter: "alpha" },
  });
}

/** Shared by the real server and the test harness. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix("api");
  // In single-container deployments the built web app is served from here too (with a strict CSP).
  const web = webDist();
  securityHeaders(app, web ? readFileSync(join(web, "index.html"), "utf8") : undefined);
  app.use(apiRateLimit());
  // OAuth discovery for MCP clients (must come before the SPA fallback).
  mountWellKnown(app);
  if (web) serveWeb(app, web);
  app.use(cookieParser());
  app.enableCors({ origin: (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => cb(null, originAllowed(origin)), credentials: true });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  if (config().NODE_ENV !== "test") setupSwagger(app);
  return app;
}

export async function createApp() {
  // rawBody keeps the exact bytes for webhook signature checks.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: false });
  app.useBodyParser("json", { limit: "5mb" });
  const trust = config().TRUST_PROXY;
  app.set("trust proxy", trust === "true" ? true : /^\d+$/.test(trust) ? Number(trust) : trust);
  return configureApp(app);
}

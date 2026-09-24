import { Controller, Get, Inject, Module } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "./core/context";
import { DB, type Db } from "./core/database/database";
import { DatabaseModule } from "./core/database/database.module";
import { AppError } from "./core/http";
import { JobsModule } from "./core/jobs/jobs.module";
import { MailModule } from "./core/mail";
import { EventsModule } from "./core/events";
import { StorageModule } from "./core/storage";
import { AccessModule } from "./modules/access/access.service";
import { AgentsModule } from "./modules/agents/agents.controller";
import { McpModule } from "./modules/mcp/mcp.controller";
import { OAuthModule } from "./modules/oauth/oauth.controller";
import { PluginsModule } from "./modules/plugins/plugins.controller";
import { AuthModule } from "./modules/auth/auth.module";
import { DevModule } from "./modules/dev/demo.seeder";
import { DocsModule } from "./modules/docs/docs.controller";
import { GithubModule } from "./modules/github/github.module";
import { NotificationsModule } from "./modules/notifications/notifications.service";
import { RealtimeModule } from "./modules/realtime/realtime.gateway";
import { UploadsModule } from "./modules/uploads/uploads.controller";
import { WorkModule } from "./modules/work/work.module";

/** Liveness + readiness: also checks the database, so orchestrators restart a broken instance. */
@ApiTags("Health")
@Controller("health")
class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Public()
  @Get()
  async health() {
    try {
      await this.db.execute(sql`select 1`);
      return { ok: true, db: "up" };
    } catch {
      throw new AppError(503, "Database unavailable");
    }
  }
}

@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    JobsModule,
    MailModule,
    StorageModule,
    AuthModule,
    AccessModule,
    AgentsModule,
    WorkModule,
    DocsModule,
    NotificationsModule,
    RealtimeModule,
    McpModule,
    OAuthModule,
    PluginsModule,
    UploadsModule,
    GithubModule,
    // Demo seeding and the reset endpoint only exist outside production.
    ...(process.env.NODE_ENV === "production" ? [] : [DevModule]),
  ],
  controllers: [HealthController],
})
export class AppModule {}

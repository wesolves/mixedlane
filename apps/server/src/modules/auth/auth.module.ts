import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { OrgsController, CurrentOrgController } from "../orgs/orgs.controller";
import { OrgsService } from "../orgs/orgs.service";
import { AuthController, InviteLinksController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

@Global()
@Module({
  imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 1000 }])],
  controllers: [AuthController, InviteLinksController, OrgsController, CurrentOrgController],
  providers: [AuthService, OrgsService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, OrgsService],
})
export class AuthModule {}

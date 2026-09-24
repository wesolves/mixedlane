import { Controller, Get, Module, Param, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Public } from "../../core/context";
import { notFound } from "../../core/http";
import { OAuthModule } from "../oauth/oauth.controller";
import { OAuthService, originOf } from "../oauth/oauth.service";
import { PLUGIN_CLIENTS, PluginsService } from "./plugins.service";
import { tarGz } from "./tar";

/**
 * Agent plugins (Claude Code, Codex, Copilot, opencode, Pi), generated on request with this
 * server's URLs baked in. Public: bundles contain no secrets — clients sign in via OAuth (or, for
 * Pi, an API key from the user's environment).
 */
@ApiTags("Agent plugins")
@Controller("plugins")
export class PluginsController {
  constructor(
    private readonly plugins: PluginsService,
    private readonly oauth: OAuthService,
  ) {}

  private urls(req: Request) {
    const api = originOf(req);
    return { api, web: this.oauth.webOrigin(req), mcp: `${api}/api/mcp` };
  }

  @Public()
  @Get()
  list(@Req() req: Request) {
    return this.plugins.list(this.urls(req));
  }

  /** `<client>.tar.gz`, `install.sh` or `install.ps1`. */
  @Public()
  @Get(":file")
  file(@Param("file") file: string, @Req() req: Request, @Res() res: Response) {
    const urls = this.urls(req);
    res.setHeader("cache-control", "no-store");
    if (file === "install.sh") return res.type("text/x-shellscript; charset=utf-8").send(this.plugins.installSh(urls));
    if (file === "install.ps1") return res.type("text/plain; charset=utf-8").send(this.plugins.installPs1(urls));
    const client = file.replace(/\.tar\.gz$/, "");
    if (!file.endsWith(".tar.gz") || !(PLUGIN_CLIENTS as readonly string[]).includes(client)) throw notFound("Plugin");
    res.setHeader("content-disposition", `attachment; filename="flowboard-${client}.tar.gz"`);
    return res.type("application/gzip").send(tarGz(this.plugins.bundle(client, urls)));
  }
}

@Module({ imports: [OAuthModule], controllers: [PluginsController], providers: [PluginsService] })
export class PluginsModule {}

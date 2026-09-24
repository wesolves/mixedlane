import { Controller, Delete, Get, HttpCode, Module, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage } from "node:http";
import type { Request, Response } from "express";
import { Ctx, type RequestContext } from "../../core/context";
import { AppError } from "../../core/http";
import { DocsModule } from "../docs/docs.controller";
import { WorkModule } from "../work/work.module";
import { McpService } from "./mcp.service";
import { PlanningService } from "./planning.service";

const methodNotAllowed = { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this server is stateless, use POST" }, id: null };

/**
 * Remote MCP endpoint (Streamable HTTP, stateless) at /api/mcp.
 * Authenticate with an agent API key: `Authorization: Bearer fb_…`.
 */
@ApiExcludeController()
@Controller("mcp")
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  async handle(@Ctx() ctx: RequestContext, @Req() req: Request, @Res() res: Response) {
    if (!ctx.agent) throw new AppError(403, "The MCP endpoint is for AI agents — create one in Organization settings → AI agents and use its API key");
    // The SDK insists clients accept both JSON and SSE; we always answer with plain JSON, so
    // accept clients that only send `Accept: application/json` (or nothing) as well.
    const accept = req.headers.accept ?? "";
    if (!accept.includes("text/event-stream") || !accept.includes("application/json")) {
      req.headers.accept = "application/json, text/event-stream";
    }
    const server = this.mcp.build(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    // Our req.auth (session info) is never set for agents, so the SDK sees no auth info of its own.
    await transport.handleRequest(req as unknown as IncomingMessage, res, req.body);
  }

  @Get()
  @HttpCode(405)
  get() {
    return methodNotAllowed;
  }

  @Delete()
  @HttpCode(405)
  remove() {
    return methodNotAllowed;
  }
}

@Module({ imports: [WorkModule, DocsModule], controllers: [McpController], providers: [McpService, PlanningService] })
export class McpModule {}

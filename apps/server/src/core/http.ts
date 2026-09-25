import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
  type PipeTransform,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { ZodSchema } from "zod";

/** Domain errors thrown by services; mapped to HTTP by the filter below. */
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 503,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, `${what} not found`);

/** Validates a request body/query with a shared Zod schema and returns the parsed value. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path.join(".");
      throw new AppError(400, issue ? (field ? `${field}: ${issue.message}` : issue.message) : "Invalid input");
    }
    return result.data;
  }
}

/** Every error leaves as `{ error: string }` — the shape the web client expects. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("Error");

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof AppError) {
      // MCP clients follow resource_metadata to discover OAuth (browser sign-in); clients
      // configured with an agent API key never get here.
      const req = host.switchToHttp().getRequest<Request>();
      if (err.status === 401 && req.path.startsWith("/api/mcp")) {
        const origin = `${req.protocol}://${req.get("host")}`;
        res.setHeader(
          "WWW-Authenticate",
          `Bearer realm="mixedlane", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", error="invalid_token", error_description="Sign in with OAuth, or send an agent API key: Authorization: Bearer ml_..."`,
        );
      }
      return res.status(err.status).json({ error: err.message });
    }
    if (err instanceof HttpException) {
      const body = err.getResponse();
      const message = typeof body === "string" ? body : ((body as { message?: string | string[] }).message ?? err.message);
      return res.status(err.getStatus()).json({ error: Array.isArray(message) ? message.join(", ") : message });
    }
    this.logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Internal server error" });
  }
}

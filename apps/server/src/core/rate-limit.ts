import type { NextFunction, Request, Response } from "express";
import { config } from "./config";

const WINDOW_MS = 60_000;

/**
 * Fixed-window rate limit for the whole API: API_RATE_LIMIT requests per minute per client,
 * where a client is an agent API key (by its public prefix) or otherwise the IP address.
 * In-memory, so it's per server instance — put a shared limiter (e.g. Redis) in front when
 * running several instances. Auth endpoints additionally have their own stricter limits.
 */
export function apiRateLimit() {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }, WINDOW_MS);
  sweep.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/") || req.path === "/api/health") return next();
    const limit = config().API_RATE_LIMIT;
    const auth = req.header("authorization");
    const client = auth?.startsWith("Bearer ml_") ? `key:${auth.slice(7, 22)}` : `ip:${req.ip}`;
    const now = Date.now();
    let w = windows.get(client);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + WINDOW_MS };
      windows.set(client, w);
    }
    w.count++;
    const reset = Math.ceil((w.resetAt - now) / 1000);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - w.count)));
    res.setHeader("RateLimit-Reset", String(reset));
    if (w.count > limit) {
      res.setHeader("Retry-After", String(reset));
      res.status(429).json({ error: `Too many requests — try again in ${reset}s` });
      return;
    }
    next();
  };
}

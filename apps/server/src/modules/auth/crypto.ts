import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../../core/config";
import { devSecret } from "../../core/secrets";

/* ---------- Passwords (scrypt; no native dependencies) ---------- */

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const scryptAsync = (pw: string, salt: Buffer, opts: ScryptOptions, keylen: number) =>
  new Promise<Buffer>((resolve, reject) => scrypt(pw, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scryptAsync(password, salt, { N, r, p, maxmem: 256 * N * r }, keylen);
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const N = Number(n);
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), { N, r: Number(r), p: Number(p), maxmem: 256 * N * Number(r) }, expected.length);
  return timingSafeEqual(actual, expected);
}

/** Burns the same time as a real check so unknown emails can't be detected by timing. */
export const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

/* ---------- Opaque tokens (refresh, reset, invite) ---------- */

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/* ---------- JWT access tokens ---------- */

let secret: Uint8Array | null = null;
const jwtKey = () => (secret ??= new TextEncoder().encode(config().JWT_SECRET ?? devSecret("jwt")));

export interface AccessClaims {
  sub: string;
  sid: string;
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid, typ: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("flowboard")
    .setExpirationTime(`${config().ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(jwtKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, jwtKey(), { issuer: "flowboard", algorithms: ["HS256"] });
    if (payload.typ !== "access" || typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

/** Short-lived token in an httpOnly cookie so <img>/<video> can load protected uploads. */
export async function signFileToken(userId: string): Promise<string> {
  return new SignJWT({ typ: "file" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setIssuer("flowboard").setExpirationTime("1d").sign(jwtKey());
}

export async function verifyFileToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtKey(), { issuer: "flowboard", algorithms: ["HS256"] });
    return payload.typ === "file" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

import { gzipSync } from "node:zlib";

/**
 * Minimal ustar writer — enough for plugin bundles (regular files, short paths), so we don't need a
 * dependency. Directories are implied by file paths; `tar -xzf` creates them.
 */
function header(path: string, size: number, mode: number) {
  const buf = Buffer.alloc(512, 0);
  let name = path;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const cut = path.lastIndexOf("/", 155);
    if (cut <= 0 || Buffer.byteLength(path.slice(cut + 1)) > 100) throw new Error(`Path too long for tar: ${path}`);
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  const put = (value: string, offset: number, length: number) => buf.write(value, offset, length, "utf8");
  const octal = (n: number, length: number) => n.toString(8).padStart(length - 1, "0") + "\0";
  put(name, 0, 100);
  put(octal(mode, 8), 100, 8);
  put(octal(0, 8), 108, 8); // uid
  put(octal(0, 8), 116, 8); // gid
  put(octal(size, 12), 124, 12);
  put(octal(Math.floor(Date.now() / 1000), 12), 136, 12);
  put("        ", 148, 8); // checksum placeholder (spaces)
  put("0", 156, 1); // regular file
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of buf) sum += b;
  put(octal(sum, 7) + " ", 148, 8);
  return buf;
}

export function tarGz(files: Map<string, string | Buffer>): Buffer {
  const parts: Buffer[] = [];
  for (const [path, content] of files) {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const executable = /\.(sh|mjs)$/.test(path);
    parts.push(header(path, data.length, executable ? 0o755 : 0o644), data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(parts));
}

// Compiles the API (and the shared package) to plain ESM JavaScript in build/, mirroring the repo
// layout so paths like apps/server/drizzle keep working:
//   build/apps/server/src/**.js   build/apps/server/drizzle/   build/packages/shared/src/**.js
// SWC (not tsc/esbuild) because Nest's dependency injection needs emitted decorator metadata.
// Imports get explicit .js extensions and the @mixedlane/shared alias becomes a relative path.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { transformFile } from "@swc/core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build");
const sources = ["apps/server/src", "packages/shared/src"];
const sharedEntry = join(out, "packages/shared/src/index.js");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".d.ts") ? [p] : [];
  });

const toPosix = (p) => p.split(sep).join("/");

/** "./foo" → "./foo.js" or "./foo/index.js"; "@mixedlane/shared" → relative path to the built package. */
function rewrite(spec, srcFile, outFile) {
  if (spec === "@mixedlane/shared") {
    let rel = toPosix(relative(dirname(outFile), sharedEntry));
    return rel.startsWith(".") ? rel : `./${rel}`;
  }
  if (!spec.startsWith(".")) return spec;
  const base = resolve(dirname(srcFile), spec);
  if (existsSync(`${base}.ts`)) return `${spec}.js`;
  if (existsSync(join(base, "index.ts"))) return `${spec}/index.js`;
  return spec;
}

rmSync(out, { recursive: true, force: true });
let count = 0;
for (const srcDir of sources) {
  for (const file of walk(join(root, srcDir))) {
    const outFile = join(out, relative(root, file)).replace(/\.ts$/, ".js");
    const { code, map } = await transformFile(file, {
      sourceMaps: true,
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true, useDefineForClassFields: false },
        keepClassNames: true,
      },
    });
    const fixed = code.replace(
      /(\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"']+)\2/g,
      (_m, lead, q, spec) => `${lead}${q}${rewrite(spec, file, outFile)}${q}`,
    );
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, `${fixed}\n//# sourceMappingURL=${outFile.split(sep).pop()}.map\n`);
    if (map) writeFileSync(`${outFile}.map`, map);
    count++;
  }
}
cpSync(join(root, "apps/server/drizzle"), join(out, "apps/server/drizzle"), { recursive: true });
console.log(`Built ${count} files into ${relative(root, out)}/`);

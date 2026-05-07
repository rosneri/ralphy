import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const pkg = (await Bun.file(resolve(root, "package.json")).json()) as { version: string };

const result = await Bun.build({
  entrypoints: [resolve(root, "apps/cli/src/index.ts")],
  outdir: resolve(root, "dist/cli"),
  target: "bun",
  define: {
    RALPH_VERSION: JSON.stringify(pkg.version),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

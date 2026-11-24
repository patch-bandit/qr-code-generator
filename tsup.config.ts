import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  outExtension: () => ({ js: ".mjs" }),
  target: "node20",
  platform: "node",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Libraries stay as installed dependencies, except the decoder: its ESM files use
  // extensionless imports that Node cannot load, so it is bundled into the CLI.
  external: ["@napi-rs/canvas", "qrcode", "zod"],
  noExternal: ["@zxing/library"],
});


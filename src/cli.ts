import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { renderSvg, verify } from "./core";
import { landsInside, loadConfigFile, outputNameProblem } from "./node/files";
import { nodeRasterizer } from "./node/raster";

const HELP = `bandit-codes: make a QR code from a JSON config. Nothing leaves your computer.

Usage:
  bandit-codes <config.json> [-o <file>] [--format png|svg] [--no-verify]

Options:
  -o, --out <file>     Where to write the image (default: output.file in the config, else bandit-codes.<format>)
  -f, --format <fmt>   png or svg (default: from -o, else output.format in the config)
  --no-verify          Skip the read-back check
  -h, --help           Show this help

Exit codes: 0 ok and scans, 1 usage error, 2 invalid config, 3 written but did not read back.`;

type Args = { config?: string; out?: string; format?: string; verify: boolean; help: boolean };

function parseArgs(argv: string[]): Args | string {
  const a: Args = { verify: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "-h" || v === "--help") a.help = true;
    else if (v === "--no-verify") a.verify = false;
    else if (v === "-o" || v === "--out" || v === "-f" || v === "--format") {
      const next = argv[++i];
      if (next === undefined || next.startsWith("-")) return `${v} needs a value`;
      if (v === "-o" || v === "--out") a.out = next;
      else a.format = next;
    }
    else if (v.startsWith("-")) return `Unknown option ${v}`;
    else if (!a.config) a.config = v;
    else return `Unexpected argument ${v}`;
  }
  return a;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(`${args}\n\n${HELP}`);
    return 1;
  }
  if (args.help || !args.config) {
    console.log(HELP);
    return args.help ? 0 : 1;
  }
  const res = loadConfigFile(args.config);
  if (!res.ok) {
    console.error("The config is not valid:");
    for (const e of res.errors) console.error(`  ${e}`);
    return 2;
  }
  const config = res.config;
  const fromOut = args.out ? extname(args.out).slice(1).toLowerCase() : "";
  const format = (args.format ?? (fromOut === "svg" || fromOut === "png" ? fromOut : config.output.format)) as
    | "png"
    | "svg";
  if (format !== "png" && format !== "svg") {
    console.error("Format must be png or svg.");
    return 1;
  }
  // A path given with -o is the user's own choice. A path that comes from the config
  // file must stay inside the current folder, so a config from someone else cannot
  // overwrite files elsewhere.
  if (!args.out && config.output.file) {
    if (isAbsolute(config.output.file) || !landsInside(process.cwd(), config.output.file)) {
      console.error("The config's output file must be inside the current folder. Use -o to choose another place.");
      return 2;
    }
    const problem = outputNameProblem(config.output.file);
    if (problem) {
      console.error(`The config's output file is not allowed: ${problem} Use -o to choose another name.`);
      return 2;
    }
  }
  const out = resolve(args.out ?? config.output.file ?? `bandit-codes.${format}`);
  const svg = renderSvg(config);
  mkdirSync(dirname(out), { recursive: true });
  if (format === "svg") writeFileSync(out, svg);
  else writeFileSync(out, await nodeRasterizer.toPng(svg, config.style.size));
  console.log(`Wrote ${out}`);

  if (args.verify) {
    const v = await verify(config, nodeRasterizer);
    if (v.ok) console.log("Scan check: scans, and reads back the same content.");
    else {
      console.error(`Scan check: won't scan. ${v.message}`);
      return 3;
    }
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);

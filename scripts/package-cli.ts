import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

type PackageCliOptions = {
  outDir: string;
  outfile: string;
  target?: string;
};

function parseOptions(args: string[]): PackageCliOptions {
  const outDir = valueFor(args, "--outdir") ?? join(process.cwd(), "dist");
  const outfile = valueFor(args, "--outfile") ?? join(outDir, process.platform === "win32" ? "rb.exe" : "rb");
  return {
    outDir,
    outfile,
    target: valueFor(args, "--target")
  };
}

function valueFor(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const options = parseOptions(process.argv.slice(2));
const outDir = options.outDir;
await mkdir(outDir, { recursive: true });
await mkdir(dirname(options.outfile), { recursive: true });

const result = await Bun.build({
  entrypoints: [join(process.cwd(), "apps/cli/src/cli.ts")],
  outdir: outDir,
  target: "bun",
  compile: {
    outfile: options.outfile,
    ...(options.target ? { target: options.target } : {})
  }
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(options.outfile);

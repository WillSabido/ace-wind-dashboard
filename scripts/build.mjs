// Bundles src/main.ts into assets/js/dashboard.js (the file WordPress loads).
//   node scripts/build.mjs            write the bundle
//   node scripts/build.mjs --verify   fail if the committed bundle is out of date
import { build } from "esbuild";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "assets/js/dashboard.js");
const verify = process.argv.includes("--verify");

const result = await build({
  entryPoints: [resolve(root, "src/main.ts")],
  bundle: true,
  format: "iife",
  target: "es2018",
  platform: "browser",
  charset: "utf8",
  banner: {
    js: '/*! ACE Wind Turbine Dashboard - generated from src/ (TypeScript). Do not edit: run "npm run build". */',
  },
  write: !verify,
  outfile,
  logLevel: "warning",
});

if (verify) {
  const fresh = result.outputFiles[0].text;
  const current = existsSync(outfile) ? readFileSync(outfile, "utf8") : "";
  if (fresh !== current) {
    console.error(
      'assets/js/dashboard.js is out of date. Run "npm run build".',
    );
    process.exit(1);
  }
  console.log("assets/js/dashboard.js is up to date.");
} else {
  console.log("Built assets/js/dashboard.js");
}

// Builds every generated file the plugin ships:
//   assets/js/dashboard.js              the [ace_wind_dashboard] shortcode script
//   blocks/live-reading/view.js         front-end script of the ACE Live Reading block
//   blocks/live-reading/editor.js       block editor script (+ editor.asset.php listing its WordPress dependencies)
//   blocks/live-reading/style.css       copied from src/reading/style.css (editor.css likewise)
//
//   node scripts/build.mjs            write everything
//   node scripts/build.mjs --verify   fail if any committed generated file is out of date
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// const outfile = resolve(root, "assets/js/dashboard.js");
const verify = process.argv.includes("--verify");
const banner = (what) =>
  `/*! ACE Wind Turbine Dashboard - ${what} - generated from src/ (TypeScript). Do not edit: run "npm run build". */`;

const bundles = [
  { entry: "src/main.ts", out: "assets/js/dashboard.js", what: "dashboard" },
  {
    entry: "src/reading/view-main.ts",
    out: "blocks/live-reading/view.js",
    what: "live reading block (front end)",
  },
  {
    entry: "src/reading/editor-main.ts",
    out: "blocks/live-reading/editor.js",
    what: "live reading block (editor)",
  },
];
const copies = [
  { from: "src/reading/style.css", to: "blocks/live-reading/style.css" },
  { from: "src/reading/editor.css", to: "blocks/live-reading/editor.css" },
];

// WordPress script handles the editor bundle relies on (it uses the globals wp.blocks, wp.element, ...).
const editorDeps = [
  "wp-blocks",
  "wp-element",
  "wp-block-editor",
  "wp-components",
  "wp-i18n",
];

/** Collect every generated file as { path, content } without writing yet. */
async function generate() {
  const files = [];
  for (const b of bundles) {
    const r = await build({
      entryPoints: [resolve(root, b.entry)],
      bundle: true,
      format: "iife",
      target: "es2018",
      platform: "browser",
      charset: "utf8",
      banner: { js: banner(b.what) },
      write: false,
      outfile: resolve(root, b.out),
      logLevel: "warning",
    });
    files.push({ path: b.out, content: r.outputFiles[0].text });
  }
  for (const c of copies)
    files.push({
      path: c.to,
      content: readFileSync(resolve(root, c.from), "utf8"),
    });

  const editor = files.find((f) => f.path === "blocks/live-reading/editor.js");
  const version = createHash("sha1")
    .update(editor.content)
    .digest("hex")
    .slice(0, 12);
  files.push({
    path: "blocks/live-reading/editor.asset.php",
    content: `<?php return array( 'dependencies' => array( ${editorDeps.map((d) => `'${d}'`).join(", ")} ), 'version' => '${version}' );\n`,
  });
  return files;
}

const files = await generate();
if (verify) {
  const stale = files.filter((f) => {
    const p = resolve(root, f.path);
    return !existsSync(p) || readFileSync(p, "utf8") !== f.content;
  });
  if (stale.length) {
    console.error(
      'Out of date (run "npm run build"):\n  ' +
        stale.map((f) => f.path).join("\n  "),
    );
    process.exit(1);
  }
  console.log("assets/js/dashboard.js and the block files are up to date.");
} else {
  for (const f of files) {
    const p = resolve(root, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
    console.log("Built " + f.path);
  }
}

# Development

The front end is written in **TypeScript** (`src/`) and bundled with **esbuild** into classic scripts WordPress loads:
`assets/js/dashboard.js` (the shortcode) and `blocks/live-reading/` (the ACE Live Reading block). The generated files are
committed so the plugin works straight from a zip with no build step.

## Layout

| Path | Purpose |
|---|---|
| `src/types.ts` | Interfaces: shortcode config, catalogue, API data, UI state (and the `window.uPlot` global) |
| `src/constants.ts` | Time ranges, colours, compass points, resolution limits, thresholds |
| `src/util.ts` | Pure helpers: `pickRes`, `nf`, `clock`, `lastVal`, `fieldLabel`, DOM builder `h` |
| `src/api.ts` | Typed `request()`, `ApiError`, `errorInfo()`, shared `catalogue()` fetch |
| `src/dashboard.ts` | The `Dash` class (menus, tiles/status chip, chart, live refresh, CSV) |
| `src/main.ts` | Entry point; bundled to `assets/js/dashboard.js` |
| `src/reading/metrics.ts` | Live-reading measurements: units, formatting, gauge fraction and every animation input (`computeDisplay`) |
| `src/reading/icons.ts` | Built-in animated SVG icons and `safeImageUrl` |
| `src/reading/readings.ts` | `ReadingHub`: one shared poller per data set, back-off, visibility handling |
| `src/reading/reading-view.ts` | `mountReading` builds and updates a tile (front end *and* editor preview); `initReadings` |
| `src/reading/block-model.ts` | Editor options, defaults, attribute changes, `buildConfig` (pure, unit-tested) |
| `src/reading/editor.ts` | `registerBlock(wp)`: the inspector UI; `view-main.ts` / `editor-main.ts` are the entry points |
| `src/reading/style.css`, `editor.css` | Block styles and the CSS animations (copied to `blocks/live-reading/`) |
| `blocks/live-reading/block.json` | Hand-written block metadata (attributes, supports). Defaults must match `DEFAULT_ATTRS` and PHP `defaults()`; tests enforce it |
| `includes/class-ace-wind-live-reading.php` | Registers the block, whitelists/clamps every attribute, prints the container |
| `scripts/build.mjs` | esbuild script for all generated files (`--verify` fails if any is stale) |
| `assets/vendor/` | uPlot (MIT), loaded by WordPress as a separate script; `src/` only imports its *types* |

## Commands

    npm install
    npm run typecheck   # tsc --noEmit (strict)
    npm test            # Jest (against src/ and the built bundle)
    npm run build       # regenerate assets/js/dashboard.js and blocks/live-reading/*
    npm run check       # typecheck + tests + verify the bundle is current

Always run `npm run build` after editing `src/` and commit the regenerated bundle; the test suite
fails ("Stale bundle") if you forget.

## Notes

- Target is ES2018 (all evergreen browsers). The old script was ES5-style; neither ever supported IE11 (`fetch`, `Intl`).
- The PHP side is unchanged; the shortcode still writes a `data-config` JSON attribute that `Config` in `types.ts` describes.
  If you add a config key in PHP, add it to `Config` too.
- PHP tests: `composer install && vendor/bin/phpunit`. See `tests/README.md`.

## Adding a measurement to the ACE Live Reading block

1. Add an entry to `METRICS` in `src/reading/metrics.ts` (family, field, units) and a branch in `computeDisplay` for its detail line and animation inputs.
2. Add its key to `METRICS`/`LABELS` in `includes/class-ace-wind-live-reading.php` (a test compares both lists).
3. `npm run build`, then `npm run check` and `phpunit`.

Anything else the API offers is already available through "Other measurement...", which needs no code.

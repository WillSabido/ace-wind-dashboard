# Development

The dashboard's front end is written in **TypeScript** (`src/`) and bundled with **esbuild** into
`assets/js/dashboard.js`, the single classic script WordPress loads. The bundle is committed so the plugin
works straight from a zip with no build step.

## Layout

| Path | Purpose |
|---|---|
| `src/types.ts` | Interfaces: shortcode config, catalogue, API data, UI state (and the `window.uPlot` global) |
| `src/constants.ts` | Time ranges, colours, compass points, resolution limits, thresholds |
| `src/util.ts` | Pure helpers: `pickRes`, `nf`, `clock`, `lastVal`, `fieldLabel`, DOM builder `h` |
| `src/api.ts` | Typed `request()`, `ApiError`, `errorInfo()`, shared `catalogue()` fetch |
| `src/dashboard.ts` | The `Dash` class (menus, tiles/status chip, chart, live refresh, CSV) |
| `src/main.ts` | Entry point; bundled to `assets/js/dashboard.js` |
| `scripts/build.mjs` | esbuild script (`--verify` fails if the committed bundle is stale) |
| `assets/vendor/` | uPlot (MIT), loaded by WordPress as a separate script; `src/` only imports its *types* |

## Commands

    npm install
    npm run typecheck   # tsc --noEmit (strict)
    npm test            # Jest (against src/ and the built bundle)
    npm run build       # regenerate assets/js/dashboard.js
    npm run check       # typecheck + tests + verify the bundle is current

Always run `npm run build` after editing `src/` and commit the regenerated bundle; the test suite
fails ("Stale bundle") if you forget.

## Notes

- Target is ES2018 (all evergreen browsers). The old script was ES5-style; neither ever supported IE11 (`fetch`, `Intl`).
- The PHP side is unchanged; the shortcode still writes a `data-config` JSON attribute that `Config` in `types.ts` describes.
  If you add a config key in PHP, add it to `Config` too.
- PHP tests: `composer install && vendor/bin/phpunit`. See `tests/README.md`.

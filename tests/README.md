# Tests

Two independent suites, neither needs a database, a WordPress install or network access.

| Suite | Covers | Run |
|---|---|---|
| **PHPUnit** (`tests/Unit`) | REST proxy, catalogue, caching, rate-limit handling, settings sanitising, shortcode, uninstall | `composer install && vendor/bin/phpunit` (or just `phpunit`) |
| **Jest** (`tests/js`) | `assets/js/dashboard.js`: helpers, menus, requests, chart rendering, live refresh, tiles, status chip, CSV export | `npm install && npm test` |

Requirements: PHP 7.4+ / PHPUnit 9.6, and Node 18+ (Jest 29 with jsdom).

## PHP suite

Uses lightweight WordPress stubs (`wp-stubs.php`) and a fake ACE API (`TestCase.php`).

- `bootstrap.php`  loads the stubs, base test case and the plugin
- `wp-stubs.php`   WordPress stand-ins + `ACE_Test_Env` (all mutable state)
- `TestCase.php`   fake API router and helpers (`data()`, `live_params()`, `last_call()` …)
- `Unit/`          CatalogueTest, DataValidationTest, DataLatestTest, DataRangeTest, UpstreamTest, SettingsTest, ShortcodeTest, RegistrationTest

Tweak `$this->families`, `$this->assets`, `$this->range_pages` or install a custom `ACE_Test_Env::$http` callback, then call `$this->data([...])` or `$this->plugin->rest_catalogue()`.

## JavaScript suite

The script is loaded fresh into jsdom for every test. uPlot is replaced by a fake that records its options and data; `fetch` is scripted. Jest fake timers drive the refresh loops (system time is fixed at 2026-10-29T12:00:00Z).

- `helpers.js`  fixtures (`catalogue()`, `dataResponse()`), `mount()`, `settle()`, `tick(ms)`, `choose()`, `control()`
- `setup.js`    fake timers + per-test cleanup (also removes document listeners the script adds)
- `utils.test.js` (pure helpers) · `init.test.js` · `controls.test.js` · `chart.test.js` · `tiles.test.js` · `csv.test.js`

`dashboard.js` ends with a small `module.exports` guard so the helpers can be imported; it is inert in browsers.

Typical test:

    const m = mount({ range: 86400 });                // config overrides, optional fetch handler
    await settle();                                   // let catalogue + first data load finish
    choose(control(m.el, 'Data'), 'wecstd');          // use a menu by its label
    await settle();
    expect(m.fetch.chart().pop().params.family).toBe('wecstd');
    await tick(2000);                                 // advance the refresh timer

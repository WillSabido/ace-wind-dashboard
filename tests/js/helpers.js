/**
 * Test harness for assets/js/dashboard.js.
 *
 * - FakeUPlot replaces the chart library and records how it is used.
 * - A scripted `fetch` plays the part of the plugin's REST proxy.
 * - mount() builds the shortcode's container, loads a fresh copy of the script, and returns helpers.
 *
 * Tests use Jest fake timers; call `await settle()` to flush promises and `await tick(ms)` to advance time.
 */
const REST = "https://example.test/wp-json/ace-wind/v1/";
const NOW = new Date("2026-10-29T12:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

/* ---------- fixtures (same shape as the PHP /catalogue endpoint returns) ---------- */

// max_latest mirrors the plugin's effective limit: the lower of the API's advertised latest limit (2000) and its page size.
const res = (resolution, seconds, refresh, maxLatest) => ({
  resolution,
  seconds,
  refresh: refresh || seconds,
  max_page: 1000,
  max_latest: maxLatest || (seconds <= 1 ? 1000 : 2000),
});
const fld = (name, label, unit) => ({ name, label, unit: unit || "" });

function catalogue(over) {
  return Object.assign(
    {
      site: "ace",
      assets: [
        { id: "wec1", name: "ACE Turbine", type: "wec" },
        { id: "ctrl1", name: "Controller", type: "site_controller" },
      ],
      families: [
        {
          family: "site_instantaneous",
          label: "Site – live power & wind",
          scope: "site",
          assets: [],
          resolutions: [res("1s", 1, 1), res("60s", 60, 60)],
          fields: [
            fld("aggregate_active_power", "Total active power", "kW"),
            fld("aggregate_wind_speed", "Wind speed", "m/s"),
            fld("aggregate_wind_direction", "Wind direction", "deg"),
            fld("aggregate_power_factor", "Power factor"),
          ],
        },
        {
          family: "wec_instantaneous",
          label: "Turbine – live signals",
          scope: "asset",
          assets: ["wec1"],
          resolutions: [res("1s", 1, 1), res("60s", 60, 60)],
          fields: [
            fld("wec_rotor_speed", "Rotor speed", "rpm"),
            fld("wec_generator_speed", "Generator speed", "rpm"),
          ],
        },
        {
          family: "wecstd",
          label: "Turbine – statistics",
          scope: "asset",
          assets: ["wec1", "wec2"],
          resolutions: [
            res("60s", 60, 60),
            res("10m", 600, 300),
            res("daily", 86400, 3600),
          ],
          fields: [
            fld("aggregate_active_power", "Mean active power", "kW"),
            fld("wind_speed_mean", "Mean wind speed", "m/s"),
          ],
        },
        {
          family: "wec_availability",
          label: "Turbine availability (daily)",
          scope: "asset",
          assets: ["wec1"],
          resolutions: [res("daily", 86400, 3600)],
          fields: [fld("availability", "Availability", "%")],
        },
      ],
    },
    over || {},
  );
}

/** An API-shaped data response. `rows` = number of points; values default to i-based numbers. */
function dataResponse(family, resolution, fields, opts) {
  opts = opts || {};
  const rows = opts.rows == null ? 3 : opts.rows;
  const step = opts.step || 1;
  const end = opts.end || NOW_S;
  const ts = [];
  for (let i = 0; i < rows; i++) ts.push(end - (rows - 1 - i) * step);
  const series = {},
    meta = {};
  fields.forEach((f, k) => {
    series[f] =
      opts.values && opts.values[f]
        ? opts.values[f]
        : ts.map((_, i) => (k + 1) * 10 + i);
    meta[f] = opts.meta && opts.meta[f] ? opts.meta[f] : fld(f, f, "");
  });
  return {
    family,
    resolution,
    seconds: step,
    fields: meta,
    timestamps: opts.timestamps || ts,
    series,
    truncated: !!opts.truncated,
  };
}

/* ---------- fakes ---------- */

function makeFakeUPlot() {
  class FakeUPlot {
    constructor(opts, data, el) {
      this.opts = opts;
      this.data = data;
      this.el = el;
      this.destroyed = false;
      this.setData = jest.fn((d) => {
        this.data = d;
      });
      this.destroy = jest.fn(() => {
        this.destroyed = true;
      });
      this.setSize = jest.fn();
      FakeUPlot.instances.push(this);
    }
  }
  FakeUPlot.instances = [];
  FakeUPlot.tzDate = jest.fn((d) => d);
  FakeUPlot.paths = { stepped: jest.fn(() => "STEPPED_PATH") };
  return FakeUPlot;
}

/** Response-like object for the fetch mock. */
function jsonResponse(body, status, headers) {
  status = status || 200;
  const h = headers || {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) =>
        h[k] != null
          ? h[k]
          : h[k.toLowerCase()] != null
            ? h[k.toLowerCase()]
            : null,
    },
    json: () => Promise.resolve(body),
  };
}

function parseCall(url) {
  const u = new URL(url);
  const params = {};
  u.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  // "_b" is the cache-busting time bucket; keep it out of `params` so tests can compare the real parameters.
  const bucket = params._b === undefined ? undefined : Number(params._b);
  delete params._b;
  return { path: url.slice(REST.length).split("?")[0], params, bucket, url };
}

/**
 * Install a scripted fetch. `handler({path, params})` may return a body, a Promise, a Response-like
 * (from jsonResponse), or throw. Defaults: serves catalogue() and a generic dataResponse().
 */
function installFetch(handler) {
  const calls = [];
  const fn = jest.fn((url) => {
    const c = parseCall(url);
    calls.push(c);
    let out;
    try {
      out = handler ? handler(c) : undefined;
    } catch (e) {
      return Promise.reject(e);
    }
    if (out === undefined) out = defaultHandler(c);
    return Promise.resolve(out).then((r) =>
      r && typeof r.json === "function" ? r : jsonResponse(r),
    );
  });
  global.fetch = fn;
  fn.calls = calls;
  fn.data = () => calls.filter((c) => c.path === "data");
  fn.chart = () => calls.filter((c) => c.path === "data" && !c.params.limit); // chart requests (tiles use limit=5)
  fn.tiles = () => calls.filter((c) => c.path === "data" && c.params.limit);
  return fn;
}

function defaultHandler(c) {
  if (c.path === "catalogue") return catalogue();
  if (c.path === "data") {
    const fields = c.params.fields.split(",");
    const sec =
      { "1s": 1, "60s": 60, "10m": 600, daily: 86400 }[c.params.resolution] ||
      1;
    return dataResponse(c.params.family, c.params.resolution, fields, {
      step: sec,
      rows: c.params.limit ? Number(c.params.limit) : 3,
      meta: allMeta(c.params.family, fields),
    });
  }
}
function allMeta(family, fields) {
  const m = {};
  const fam = catalogue().families.find((f) => f.family === family);
  fam.fields.forEach((x) => {
    if (fields.indexOf(x.name) >= 0) m[x.name] = x;
  });
  return m;
}

/* ---------- mounting ---------- */

const DEFAULT_CFG = {
  rest: REST,
  title: "Our wind turbine – live data",
  family: "site_instantaneous",
  field: "aggregate_active_power",
  compare: "aggregate_wind_speed",
  range: 1800,
  height: 420,
  tiles: true,
  controls: true,
  ratedKw: 4200,
  liveRefresh: 2,
  tz: "UTC",
};

function containerHtml(cfg) {
  const el = document.createElement("div");
  el.className = "acewd";
  el.setAttribute("data-config", JSON.stringify(cfg));
  el.innerHTML = '<p class="acewd-loading">Loading turbine data…</p>';
  return el;
}

/**
 * Mount one or more dashboards and load a fresh copy of the script.
 * @param {object|object[]} cfgOver config overrides (array = several containers on one page)
 * @param {function} handler fetch handler (see installFetch)
 * @param {{built?: boolean}} opts built:true runs assets/js/dashboard.js instead of the TypeScript sources
 */
function mount(cfgOver, handler, opts) {
  document.body.innerHTML = "";
  const list = Array.isArray(cfgOver) ? cfgOver : [cfgOver || {}];
  const els = list.map((o) => {
    const el = containerHtml(Object.assign({}, DEFAULT_CFG, o));
    document.body.appendChild(el);
    return el;
  });
  const fetchMock = installFetch(handler);
  const FakeUPlot = makeFakeUPlot();
  window.uPlot = FakeUPlot;
  jest.spyOn(document, "addEventListener"); // so cleanupListeners() can remove what the script adds
  let api;
  if (opts && opts.built) {
    // Run the shipped bundle (assets/js/dashboard.js) exactly as a browser would: one classic <script>.
    (0, eval)(
      require("fs").readFileSync(
        require("path").join(__dirname, "../../assets/js/dashboard.js"),
        "utf8",
      ),
    );
  } else {
    jest.isolateModules(() => {
      require("../../src/main"); // entry point: builds every .acewd container
      api = require("../../src/dashboard"); // same module instance, so tests can reach Dash
    });
  }
  return { el: els[0], els, fetch: fetchMock, uPlot: FakeUPlot, api };
}

/** Remove document-level listeners added by dashboards in the test that just finished. */
function cleanupListeners() {
  const spy = document.addEventListener;
  if (!spy || !spy.mock) return;
  spy.mock.calls.forEach((c) => {
    if (c[0] === "visibilitychange" || c[0] === "DOMContentLoaded")
      document.removeEventListener(c[0], c[1], c[2]);
  });
}

/** Flush pending promise callbacks (fake-timer friendly). */
async function settle() {
  for (let i = 0; i < 12; i++) await jest.advanceTimersByTimeAsync(0);
}
/** Advance the clock, letting promise chains run in between. */
async function tick(ms) {
  await jest.advanceTimersByTimeAsync(ms);
}

/** Change a <select>/<input> value and fire the event the script listens to. */
function choose(select, value) {
  select.value = String(value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
/** Find a control by its visible label text. */
function control(root, labelText) {
  const label = Array.from(root.querySelectorAll("label")).find(
    (l) => l.textContent === labelText,
  );
  if (!label) throw new Error("No control labelled " + labelText);
  return root.querySelector("#" + label.getAttribute("for"));
}
function button(root, text) {
  const b = Array.from(root.querySelectorAll("button")).find(
    (x) => x.textContent === text,
  );
  if (!b) throw new Error("No button " + text);
  return b;
}
const optionTexts = (sel) => Array.from(sel.options).map((o) => o.textContent);
const optionValues = (sel) => Array.from(sel.options).map((o) => o.value);

module.exports = {
  REST,
  NOW,
  NOW_S,
  DEFAULT_CFG,
  catalogue,
  dataResponse,
  jsonResponse,
  fld,
  res,
  mount,
  cleanupListeners,
  settle,
  tick,
  choose,
  control,
  button,
  optionTexts,
  optionValues,
  makeFakeUPlot,
  installFetch,
};

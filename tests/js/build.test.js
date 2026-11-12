/** Guards the shipped bundle: it must match the sources, and it must work on its own. */
const { execFileSync } = require("child_process");
const path = require("path");
const H = require("./helpers");
const { mount, settle, tick, choose, control, button } = H;

const root = path.join(__dirname, "../..");

describe("assets/js/dashboard.js (generated from src/)", () => {
  test('is up to date with the TypeScript sources (run "npm run build" if this fails)', () => {
    jest.useRealTimers();
    let output = "";
    try {
      output = execFileSync(
        process.execPath,
        [path.join(root, "scripts/build.mjs"), "--verify"],
        { cwd: root, encoding: "utf8", stdio: "pipe" },
      );
    } catch (e) {
      throw new Error("Stale bundle: " + (e.stderr || e.message));
    }
    expect(output).toMatch(/up to date/);
  });

  test("is a self-contained classic script: no module syntax, no leftover imports", () => {
    const code = require("fs").readFileSync(
      path.join(root, "assets/js/dashboard.js"),
      "utf8",
    );
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    expect(code).not.toMatch(/\brequire\(/);
    expect(code).toMatch(/^\/\*! ACE Wind Turbine Dashboard/);
    expect(code).not.toMatch(/\bsourceMappingURL\b/);
  });
});

describe("the built bundle running in a page", () => {
  test("builds the dashboard, loads data, draws the chart and shows live tiles", async () => {
    const m = mount({}, undefined, { built: true });
    await settle();
    expect(m.el.querySelector(".acewd-title").textContent).toBe(
      "Our wind turbine – live data",
    );
    expect(m.el.querySelectorAll(".acewd-tile")).toHaveLength(4);
    expect(m.el.querySelectorAll(".acewd-controls select")).toHaveLength(6);
    expect(m.fetch.chart()[0].params).toEqual({
      family: "site_instantaneous",
      resolution: "1s",
      fields: "aggregate_active_power,aggregate_wind_speed",
      span: "1800",
    });
    expect(m.uPlot.instances).toHaveLength(1);
    expect(m.el.querySelector(".acewd-note").textContent).toContain(
      "1-second data",
    );
  });

  test("menus, refresh and pause work in the bundle", async () => {
    const m = mount({}, undefined, { built: true });
    await settle();
    choose(control(m.el, "Data"), "wecstd");
    await settle();
    expect(m.fetch.chart().pop().params).toMatchObject({
      family: "wecstd",
      asset: "wec1",
    });

    await tick(60000); // 60 s data refreshes about once a minute
    const n = m.fetch.chart().length;
    button(m.el, "Pause").click();
    await tick(300000);
    expect(m.fetch.chart()).toHaveLength(n);
  });

  test("handles a missing catalogue gracefully", async () => {
    const m = mount(
      {},
      (c) =>
        c.path === "catalogue"
          ? H.jsonResponse({ error: "down" }, 502)
          : undefined,
      { built: true },
    );
    await settle();
    expect(m.el.querySelector(".acewd-error").textContent).toContain("down");
  });
});

describe("the live-reading block files (generated from src/reading)", () => {
  const fs = require("fs");
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  const R = require("./reading-helpers");

  test.each(["blocks/live-reading/view.js", "blocks/live-reading/editor.js"])(
    "%s is a self-contained classic script",
    (file) => {
      const code = read(file);
      expect(code).not.toMatch(/^\s*(import|export)\s/m);
      expect(code).not.toMatch(/\brequire\(/);
      expect(code).toMatch(/^\/\*! ACE Wind Turbine Dashboard/);
      expect(code).not.toMatch(/\bsourceMappingURL\b/);
    },
  );

  test("the stylesheets are exact copies of the sources", () => {
    expect(read("blocks/live-reading/style.css")).toBe(
      read("src/reading/style.css"),
    );
    expect(read("blocks/live-reading/editor.css")).toBe(
      read("src/reading/editor.css"),
    );
  });

  test("editor.asset.php lists the WordPress scripts the editor bundle needs, with a version tied to its content", () => {
    const php = read("blocks/live-reading/editor.asset.php");
    [
      "wp-blocks",
      "wp-element",
      "wp-block-editor",
      "wp-components",
      "wp-i18n",
    ].forEach((d) => expect(php).toContain("'" + d + "'"));
    const v = php.match(/'version' => '([0-9a-f]{12})'/)[1];
    expect(v).toBe(
      require("crypto")
        .createHash("sha1")
        .update(read("blocks/live-reading/editor.js"))
        .digest("hex")
        .slice(0, 12),
    );
  });

  test("the editor bundle only uses wp.* globals that the listed dependencies provide", () => {
    const code = read("blocks/live-reading/editor.js");
    const used = new Set(
      Array.from(code.matchAll(/\bwp\.(\w+)/g)).map((m) => m[1]),
    );
    const provided = new Set([
      "blocks",
      "element",
      "blockEditor",
      "components",
      "i18n",
    ]);
    used.forEach((u) => expect(provided.has(u)).toBe(true));
  });

  test("view.js, run as a plain script, turns a container into a live tile", async () => {
    document.body.innerHTML =
      '<div class="wp-block-ace-wind-live-reading"><div class="acewd-reading" data-config=\'' +
      JSON.stringify(R.config({ metric: "wind_speed", unit: "mph" })) +
      "'></div></div>";
    const f = H.installFetch(R.readings({ aggregate_wind_speed: 5 }));
    window.uPlot = undefined;
    (0, eval)(read("blocks/live-reading/view.js"));
    await settle();
    const host = document.querySelector(".acewd-reading");
    expect(host.getAttribute("data-mounted")).toBe("1");
    expect(host.querySelector(".acewd-r__label").textContent).toBe(
      "Wind speed",
    );
    expect(R.valueText(host)).toBe("11.2");
    expect(R.unitText(host)).toBe("mph");
    expect(
      host.querySelector(".acewd-r__icon svg.acewd-ico--wind"),
    ).not.toBeNull();
    expect(f.tiles()).toHaveLength(1);
    await tick(2000);
    expect(f.tiles()).toHaveLength(2);
  });

  test("view.js waits for DOMContentLoaded if the page is still loading", async () => {
    document.body.innerHTML =
      '<div class="acewd-reading" data-config=\'' +
      JSON.stringify(R.config({})) +
      "'></div>";
    const f = H.installFetch(R.readings({ aggregate_active_power: 5 }));
    const state = jest
      .spyOn(document, "readyState", "get")
      .mockReturnValue("loading");
    (0, eval)(read("blocks/live-reading/view.js"));
    await settle();
    expect(f.calls).toHaveLength(0);
    state.mockReturnValue("interactive");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await settle();
    expect(f.calls.length).toBeGreaterThan(0);
  });

  test("editor.js, run as a plain script with wp.* present, registers the block with the printed settings", () => {
    const registered = [];
    window.wp = {
      blocks: { registerBlockType: (n, s) => registered.push([n, s]) },
      element: {
        createElement: () => ({}),
        Fragment: "F",
        useRef: () => ({ current: null }),
        useEffect: () => {},
        useState: (i) => [i, () => {}],
      },
      blockEditor: {},
      components: {},
      i18n: { __: (s) => s },
    };
    window.ACE_WIND_BLOCK = R.ENV;
    (0, eval)(read("blocks/live-reading/editor.js"));
    expect(registered.map((r) => r[0])).toEqual(["ace-wind/live-reading"]);
    delete window.wp;
    delete window.ACE_WIND_BLOCK;
  });

  test("editor.js does nothing (and does not throw) where wp.* is missing", () => {
    delete window.wp;
    expect(() =>
      (0, eval)(read("blocks/live-reading/editor.js")),
    ).not.toThrow();
  });
});

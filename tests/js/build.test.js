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

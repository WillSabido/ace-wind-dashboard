/** The pull-down menus and what they request. */
const H = require("./helpers");
const {
  mount,
  settle,
  tick,
  choose,
  control,
  button,
  optionTexts,
  optionValues,
  catalogue,
  jsonResponse,
} = H;

const CHART = (m) => m.fetch.chart();
const lastChart = (m) => CHART(m)[CHART(m).length - 1].params;

async function ready(cfg, handler) {
  const m = mount(cfg, handler);
  await settle();
  m.menu = (label) => control(m.el, label);
  return m;
}

describe("menu contents", () => {
  test("Data lists every family from the catalogue with friendly labels, in order", async () => {
    const m = await ready();
    expect(optionTexts(m.menu("Data"))).toEqual(
      catalogue().families.map((f) => f.label),
    );
    expect(m.menu("Data").value).toBe("site_instantaneous");
  });

  test("Measurement lists fields with units (no empty brackets)", async () => {
    const m = await ready();
    expect(optionTexts(m.menu("Measurement"))).toEqual([
      "Total active power (kW)",
      "Wind speed (m/s)",
      "Wind direction (deg)",
      "Power factor",
    ]);
    expect(m.menu("Measurement").value).toBe("aggregate_active_power");
  });

  test("Compare with offers None plus every other measurement", async () => {
    const m = await ready();
    expect(optionTexts(m.menu("Compare with"))).toEqual([
      "None",
      "Wind speed (m/s)",
      "Wind direction (deg)",
      "Power factor",
    ]);
    expect(m.menu("Compare with").value).toBe("aggregate_wind_speed");
  });

  test("Chart style offers line, area and steps", async () => {
    const m = await ready();
    expect(optionTexts(m.menu("Chart style"))).toEqual([
      "Line",
      "Area",
      "Steps",
    ]);
    expect(m.menu("Chart style").value).toBe("line");
  });

  test("Time period lists presets, flags unavailable ones, and ends with Custom", async () => {
    const m = await ready();
    const sel = m.menu("Time period");
    expect(optionTexts(sel)).toEqual([
      "Last 5 minutes",
      "Last 30 minutes",
      "Last hour",
      "Last 6 hours",
      "Last 24 hours",
      "Last 7 days",
      "Last 30 days (n/a)",
      "Last 90 days (n/a)",
      "Last year (n/a)",
      "Custom range…",
    ]);
    const disabled = Array.from(sel.options)
      .filter((o) => o.disabled)
      .map((o) => o.value);
    expect(disabled).toEqual(["2592000", "7776000", "31536000"]);
    expect(sel.value).toBe("1800");
  });

  test("the Turbine/unit menu is hidden when the data set has a single (or no) asset", async () => {
    const m = await ready();
    expect(m.menu("Turbine / unit").parentNode.style.display).toBe("none");
  });
});

describe("initial selection from the shortcode", () => {
  test("uses the configured family, measurement and comparison", async () => {
    const m = await ready({
      family: "wec_instantaneous",
      field: "wec_generator_speed",
      compare: "wec_rotor_speed",
    });
    expect(m.menu("Data").value).toBe("wec_instantaneous");
    expect(m.menu("Measurement").value).toBe("wec_generator_speed");
    expect(m.menu("Compare with").value).toBe("wec_rotor_speed");
  });

  test("falls back to the first family / first measurement when the configured ones do not exist", async () => {
    const m = await ready({ family: "nope", field: "nope", compare: "nope" });
    expect(m.menu("Data").value).toBe("site_instantaneous");
    expect(m.menu("Measurement").value).toBe("aggregate_active_power");
    expect(m.menu("Compare with").value).toBe("");
  });

  test("an empty or identical compare means a single line", async () => {
    expect((await ready({ compare: "" })).menu("Compare with").value).toBe("");
    expect(
      (await ready({ compare: "aggregate_active_power" })).menu("Compare with")
        .value,
    ).toBe("");
  });

  test("an unavailable initial range moves to the nearest available one", async () => {
    const m = await ready({
      family: "wec_availability",
      field: "availability",
      compare: "",
      range: 1800,
    });
    expect(m.menu("Time period").value).toBe("604800");
    expect(lastChart(m)).toMatchObject({ resolution: "daily", span: "604800" });
  });
});

describe("changing a menu requests new data", () => {
  test("initial request: finest resolution for the span, both fields, no asset for site data", async () => {
    const m = await ready();
    expect(CHART(m)).toHaveLength(1);
    const p = CHART(m)[0].params;
    expect(p).toEqual({
      family: "site_instantaneous",
      resolution: "1s",
      fields: "aggregate_active_power,aggregate_wind_speed",
      span: "1800",
    });
  });

  test("Data: switching family keeps a measurement with the same name, drops an unknown comparison, and sends the asset", async () => {
    const m = await ready();
    choose(m.menu("Data"), "wecstd");
    await settle();
    expect(m.menu("Measurement").value).toBe("aggregate_active_power"); // same name exists in wecstd
    expect(m.menu("Compare with").value).toBe(""); // wind speed isn't in wecstd
    expect(lastChart(m)).toEqual({
      family: "wecstd",
      resolution: "60s",
      fields: "aggregate_active_power",
      span: "1800",
      asset: "wec1",
    });
  });

  test("Data: a measurement name that does not exist in the new family resets to its first measurement", async () => {
    const m = await ready();
    choose(m.menu("Data"), "wec_instantaneous");
    await settle();
    expect(m.menu("Measurement").value).toBe("wec_rotor_speed");
    expect(lastChart(m).fields).toBe("wec_rotor_speed");
  });

  test("Data: multi-asset families reveal the Turbine/unit menu, falling back to the id when the name is unknown", async () => {
    const m = await ready();
    choose(m.menu("Data"), "wecstd");
    await settle();
    const sel = m.menu("Turbine / unit");
    expect(sel.parentNode.style.display).toBe("");
    expect(optionValues(sel)).toEqual(["wec1", "wec2"]);
    expect(optionTexts(sel)).toEqual(["ACE Turbine", "wec2"]);
    choose(sel, "wec2");
    await settle();
    expect(lastChart(m).asset).toBe("wec2");
  });

  test("Measurement: choosing the current comparison clears the comparison and removes it from the menu", async () => {
    const m = await ready();
    choose(m.menu("Measurement"), "aggregate_wind_speed");
    await settle();
    expect(m.menu("Compare with").value).toBe("");
    expect(optionValues(m.menu("Compare with"))).not.toContain(
      "aggregate_wind_speed",
    );
    expect(lastChart(m).fields).toBe("aggregate_wind_speed");
  });

  test("Measurement: a different measurement keeps the comparison", async () => {
    const m = await ready();
    choose(m.menu("Measurement"), "aggregate_power_factor");
    await settle();
    expect(lastChart(m).fields).toBe(
      "aggregate_power_factor,aggregate_wind_speed",
    );
  });

  test("Compare with: None requests a single field; picking one requests two", async () => {
    const m = await ready();
    choose(m.menu("Compare with"), "");
    await settle();
    expect(lastChart(m).fields).toBe("aggregate_active_power");
    choose(m.menu("Compare with"), "aggregate_wind_direction");
    await settle();
    expect(lastChart(m).fields).toBe(
      "aggregate_active_power,aggregate_wind_direction",
    );
  });

  test("Time period: spans choose an appropriate resolution", async () => {
    const m = await ready();
    choose(m.menu("Time period"), 86400);
    await settle();
    expect(lastChart(m)).toMatchObject({ span: "86400", resolution: "60s" });
    choose(m.menu("Time period"), 300);
    await settle();
    expect(lastChart(m)).toMatchObject({ span: "300", resolution: "1s" });
    expect(lastChart(m).limit).toBeUndefined();
  });

  test("Chart style: re-draws without changing the data request parameters", async () => {
    const m = await ready();
    const before = lastChart(m);
    choose(m.menu("Chart style"), "area");
    await settle();
    expect(lastChart(m)).toEqual(before);
    expect(m.uPlot.instances).toHaveLength(2);
  });

  test("Time period menu is rebuilt per family (daily-only data disables short periods)", async () => {
    const m = await ready();
    choose(m.menu("Data"), "wec_availability");
    await settle();
    const disabled = Array.from(m.menu("Time period").options)
      .filter((o) => o.disabled)
      .map((o) => o.textContent);
    expect(disabled).toEqual([
      "Last 5 minutes (n/a)",
      "Last 30 minutes (n/a)",
      "Last hour (n/a)",
      "Last 6 hours (n/a)",
      "Last 24 hours (n/a)",
    ]);
  });
});

describe("custom time range", () => {
  const local = (s) => Math.floor(new Date(s).getTime() / 1000);
  const iso = (sec) =>
    new Date(sec * 1000).toISOString().replace(/\.\d+Z$/, "Z");

  async function openCustom() {
    const m = await ready();
    choose(m.menu("Time period"), "custom");
    return m;
  }

  test("choosing Custom reveals pre-filled From/To inputs without requesting data yet", async () => {
    const m = await ready();
    const before = CHART(m).length;
    choose(m.menu("Time period"), "custom");
    const panel = m.el.querySelector(".acewd-custom");
    expect(panel.classList.contains("show")).toBe(true);
    expect(m.menu("From").value).not.toBe("");
    expect(m.menu("To").value).not.toBe("");
    await settle();
    expect(CHART(m)).toHaveLength(before);
  });

  test("Show requests that window as ISO times with no span", async () => {
    const m = await openCustom();
    m.menu("From").value = "2026-10-28T10:00";
    m.menu("To").value = "2026-10-28T12:00";
    button(m.el, "Show").click();
    await settle();
    const p = lastChart(m);
    expect(p.start).toBe(iso(local("2026-10-28T10:00")));
    expect(p.end).toBe(iso(local("2026-10-28T12:00")));
    expect(p.span).toBeUndefined();
    expect(p.resolution).toBe("60s");
  });

  test("rejects an end before the start, or empty inputs, with a message and no request", async () => {
    const m = await openCustom();
    const n = CHART(m).length;
    m.menu("From").value = "2026-10-28T12:00";
    m.menu("To").value = "2026-10-28T10:00";
    button(m.el, "Show").click();
    expect(m.el.querySelector(".acewd-msg").textContent).toBe(
      "Please choose a valid start and end time.",
    );
    expect(m.el.querySelector(".acewd-msg").classList.contains("show")).toBe(
      true,
    );
    m.menu("From").value = "";
    button(m.el, "Show").click();
    await settle();
    expect(CHART(m)).toHaveLength(n);
  });

  test("a window too long for the data set shows a message and makes no request", async () => {
    const m = await openCustom();
    const n = CHART(m).length;
    m.menu("From").value = "2026-01-01T00:00";
    m.menu("To").value = "2026-10-01T00:00"; // ~9 months of 1s/60s data
    button(m.el, "Show").click();
    await settle();
    expect(m.el.querySelector(".acewd-msg").textContent).toMatch(
      /isn.t available for this data/,
    );
    expect(CHART(m)).toHaveLength(n);
  });

  test("a custom window is not refreshed automatically", async () => {
    const m = await openCustom();
    m.menu("From").value = "2026-10-28T10:00";
    m.menu("To").value = "2026-10-28T12:00";
    button(m.el, "Show").click();
    await settle();
    const n = CHART(m).length;
    await tick(120000);
    expect(CHART(m)).toHaveLength(n);
  });

  test("going back to a preset hides the custom panel and uses a span again", async () => {
    const m = await openCustom();
    m.menu("From").value = "2026-10-28T10:00";
    m.menu("To").value = "2026-10-28T12:00";
    button(m.el, "Show").click();
    await settle();
    choose(m.menu("Time period"), 3600);
    await settle();
    expect(m.el.querySelector(".acewd-custom").classList.contains("show")).toBe(
      false,
    );
    const p = lastChart(m);
    expect(p.span).toBe("3600");
    expect(p.start).toBeUndefined();
  });
});

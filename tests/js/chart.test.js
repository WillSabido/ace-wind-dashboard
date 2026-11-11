/** Chart rendering (via the fake uPlot), live refresh, pause/resume and error recovery. */
const H = require("./helpers");
const {
  mount,
  settle,
  tick,
  choose,
  control,
  button,
  jsonResponse,
  dataResponse,
  catalogue,
  NOW_S,
} = H;

const isChart = (c) => c.path === "data" && !c.params.limit;
const plot = (m, i) =>
  m.uPlot.instances[i == null ? m.uPlot.instances.length - 1 : i];

async function ready(cfg, handler) {
  const m = mount(cfg, handler);
  await settle();
  return m;
}

function meta(...names) {
  const all = {};
  catalogue().families.forEach((f) =>
    f.fields.forEach((x) => {
      if (!all[x.name]) all[x.name] = x;
    }),
  ); // first (site) definition wins
  const out = {};
  names.forEach((n) => {
    out[n] = all[n];
  });
  return out;
}

describe("building the plot", () => {
  test("data is [timestamps, series1, series2] and options reflect the selection", async () => {
    const m = await ready();
    expect(m.uPlot.instances).toHaveLength(1);
    const p = plot(m);
    expect(p.data).toHaveLength(3);
    expect(p.data[0]).toHaveLength(3);
    expect(p.opts.series[0].label).toBe("Time");
    expect(p.opts.series[1]).toMatchObject({
      label: "Total active power (kW)",
      stroke: "#1f8a4c",
      scale: "y",
      width: 2,
      spanGaps: false,
    });
    expect(p.opts.series[2]).toMatchObject({
      label: "Wind speed (m/s)",
      stroke: "#e07b00",
    });
    expect(p.opts.height).toBe(420);
    expect(p.opts.width).toBeGreaterThanOrEqual(280);
    expect(p.el).toBe(m.el.querySelector(".acewd-chart"));
  });

  test("different units: the comparison gets its own right-hand axis", async () => {
    const p = plot(await ready());
    expect(p.opts.series[2].scale).toBe("y2");
    expect(p.opts.scales.y2).toBeDefined();
    expect(p.opts.axes).toHaveLength(3);
    expect(p.opts.axes[1]).toMatchObject({
      scale: "y",
      label: "kW",
      stroke: "#1f8a4c",
    });
    expect(p.opts.axes[2]).toMatchObject({
      scale: "y2",
      side: 1,
      label: "m/s",
      stroke: "#e07b00",
    });
  });

  test("same units: both lines share the left axis", async () => {
    const p = plot(
      await ready({
        family: "wec_instantaneous",
        field: "wec_rotor_speed",
        compare: "wec_generator_speed",
      }),
    );
    expect(p.opts.series[2].scale).toBe("y");
    expect(p.opts.scales.y2).toBeUndefined();
    expect(p.opts.axes).toHaveLength(2);
  });

  test("a single measurement draws one line and one value axis", async () => {
    const p = plot(await ready({ compare: "" }));
    expect(p.opts.series).toHaveLength(2);
    expect(p.opts.axes).toHaveLength(2);
    expect(p.data).toHaveLength(2);
  });

  test("time is displayed in the configured time zone", async () => {
    const m = await ready({ tz: "Europe/London" });
    const p = plot(m);
    p.opts.tzDate(1790000000);
    expect(m.uPlot.tzDate).toHaveBeenCalledTimes(1);
    const arg = m.uPlot.tzDate.mock.calls[0];
    expect(arg[0]).toEqual(new Date(1790000000 * 1000));
    expect(arg[1]).toBe("Europe/London");
  });

  test("dragging selects a time range only (horizontal zoom)", async () => {
    expect(plot(await ready()).opts.cursor.drag).toEqual({ x: true, y: false });
  });

  test("legend value formatters: two decimals, en dash for gaps, readable timestamp", async () => {
    const p = plot(await ready());
    expect(p.opts.series[1].value(null, 12.3456)).toBe("12.35");
    expect(p.opts.series[1].value(null, null)).toBe("–");
    expect(p.opts.series[0].value(null, null)).toBe("");
    expect(p.opts.series[0].value(null, NOW_S)).toMatch(/29 Oct.*12:00:00/);
  });

  test("chart styles: line is plain, area fills, steps use the stepped path", async () => {
    const m = await ready();
    expect(plot(m).opts.series[1].fill).toBeUndefined();
    expect(plot(m).opts.series[1].paths).toBeUndefined();

    choose(control(m.el, "Chart style"), "area");
    await settle();
    expect(plot(m).opts.series[1].fill).toBe("#1f8a4c30");
    expect(plot(m).opts.series[2].fill).toBe("#e07b0030");

    choose(control(m.el, "Chart style"), "step");
    await settle();
    expect(m.uPlot.paths.stepped).toHaveBeenCalledWith({ align: 1 });
    expect(plot(m).opts.series[1].paths).toBe("STEPPED_PATH");
  });

  test("changing the selection destroys the old plot and builds a new one", async () => {
    const m = await ready();
    const first = plot(m);
    choose(control(m.el, "Measurement"), "aggregate_power_factor");
    await settle();
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(m.uPlot.instances).toHaveLength(2);
    expect(plot(m).opts.series[1].label).toBe("Power factor");
  });

  test("the plot follows container resizes", async () => {
    let cb;
    window.ResizeObserver = class {
      constructor(f) {
        cb = f;
      }
      observe() {}
      disconnect() {}
    };
    const m = await ready({ height: 333 });
    cb();
    expect(plot(m).setSize).toHaveBeenCalledWith(
      expect.objectContaining({ height: 333 }),
    );
  });
});

describe("data handling", () => {
  test("timestamps arriving out of order are sorted, keeping each series aligned", async () => {
    const m = await ready({ compare: "aggregate_wind_speed" }, (c) => {
      if (!isChart(c)) return undefined;
      return dataResponse(
        "site_instantaneous",
        "1s",
        ["aggregate_active_power", "aggregate_wind_speed"],
        {
          timestamps: [30, 10, 20],
          values: {
            aggregate_active_power: [3, 1, 2],
            aggregate_wind_speed: [30, 10, 20],
          },
          meta: meta("aggregate_active_power", "aggregate_wind_speed"),
        },
      );
    });
    expect(plot(m).data).toEqual([
      [10, 20, 30],
      [1, 2, 3],
      [10, 20, 30],
    ]);
  });

  test("nulls are passed through so the line shows a gap", async () => {
    const m = await ready({ compare: "" }, (c) =>
      isChart(c)
        ? dataResponse("site_instantaneous", "1s", ["aggregate_active_power"], {
            values: { aggregate_active_power: [1, null, 3] },
            meta: meta("aggregate_active_power"),
          })
        : undefined,
    );
    expect(plot(m).data[1]).toEqual([1, null, 3]);
  });

  test.each([
    ["no rows", { timestamps: [], values: { aggregate_active_power: [] } }],
    ["only nulls", { values: { aggregate_active_power: [null, null, null] } }],
  ])('%s: shows "No data" and draws nothing', async (_n, over) => {
    const m = await ready({ compare: "" }, (c) =>
      isChart(c)
        ? dataResponse(
            "site_instantaneous",
            "1s",
            ["aggregate_active_power"],
            Object.assign({ meta: meta("aggregate_active_power") }, over),
          )
        : undefined,
    );
    const msg = m.el.querySelector(".acewd-msg");
    expect(msg.textContent).toBe("No data available for this period.");
    expect(msg.classList.contains("show")).toBe(true);
    expect(m.uPlot.instances).toHaveLength(0);
    expect(m.el.querySelector(".acewd-note").textContent).toBe("");
  });

  test("an empty period clears the old plot, and the message disappears when data returns", async () => {
    let empty = false;
    const m = await ready({ compare: "" }, (c) => {
      if (!isChart(c)) return undefined;
      return dataResponse(
        "site_instantaneous",
        "1s",
        ["aggregate_active_power"],
        {
          rows: empty ? 0 : 3,
          timestamps: empty ? [] : undefined,
          values: empty ? { aggregate_active_power: [] } : undefined,
          meta: meta("aggregate_active_power"),
        },
      );
    });
    const first = plot(m);
    empty = true;
    await tick(2000);
    expect(first.destroy).toHaveBeenCalled();
    expect(m.el.querySelector(".acewd-msg").classList.contains("show")).toBe(
      true,
    );
    empty = false;
    await tick(2000);
    expect(m.el.querySelector(".acewd-msg").classList.contains("show")).toBe(
      false,
    );
    expect(m.uPlot.instances).toHaveLength(2);
  });

  test("the note describes resolution, point count and live status", async () => {
    const m = await ready();
    expect(m.el.querySelector(".acewd-note").textContent).toBe(
      "Showing 1-second data · 3 points · live · drag to zoom, double-click to reset",
    );
  });

  test("the note names other resolutions and flags shortened results", async () => {
    const m = await ready({ range: 86400 }, (c) =>
      isChart(c)
        ? Object.assign(
            dataResponse(
              "site_instantaneous",
              "60s",
              ["aggregate_active_power", "aggregate_wind_speed"],
              {
                step: 60,
                meta: meta("aggregate_active_power", "aggregate_wind_speed"),
              },
            ),
            { truncated: true },
          )
        : undefined,
    );
    const note = m.el.querySelector(".acewd-note").textContent;
    expect(note).toContain("1-minute data");
    expect(note).toContain("(shortened)");
  });

  test("a custom window is not labelled live", async () => {
    const m = await ready();
    choose(control(m.el, "Time period"), "custom");
    control(m.el, "From").value = "2026-10-28T10:00";
    control(m.el, "To").value = "2026-10-28T12:00";
    button(m.el, "Show").click();
    await settle();
    expect(m.el.querySelector(".acewd-note").textContent).not.toContain("live");
  });

  test("requests for an asset family include the asset id", async () => {
    const m = await ready({
      family: "wec_instantaneous",
      field: "wec_rotor_speed",
      compare: "",
    });
    expect(m.fetch.chart()[0].params).toEqual({
      family: "wec_instantaneous",
      resolution: "1s",
      fields: "wec_rotor_speed",
      span: "1800",
      asset: "wec1",
    });
  });
});

describe("live refresh", () => {
  test("1-second data refreshes every liveRefresh seconds, updating the existing plot in place", async () => {
    const m = await ready({ liveRefresh: 3 });
    expect(m.fetch.chart()).toHaveLength(1);
    await tick(2999);
    expect(m.fetch.chart()).toHaveLength(1);
    await tick(1);
    expect(m.fetch.chart()).toHaveLength(2);
    expect(m.uPlot.instances).toHaveLength(1);
    expect(plot(m).setData).toHaveBeenCalledTimes(1);
    expect(plot(m).setData.mock.calls[0][1]).toBe(true); // reset scales
    await tick(3000);
    expect(m.fetch.chart()).toHaveLength(3);
  });

  test("coarser data uses the API's recommended refresh (at least 5 s)", async () => {
    const m = await ready({ range: 86400 }, (c) =>
      isChart(c)
        ? dataResponse(
            "site_instantaneous",
            "60s",
            ["aggregate_active_power", "aggregate_wind_speed"],
            {
              step: 60,
              meta: meta("aggregate_active_power", "aggregate_wind_speed"),
            },
          )
        : undefined,
    );
    expect(m.fetch.chart()).toHaveLength(1);
    await tick(59000);
    expect(m.fetch.chart()).toHaveLength(1);
    await tick(1000);
    expect(m.fetch.chart()).toHaveLength(2);
  });

  test("Pause stops chart refreshes; Resume live updates immediately and restarts the loop", async () => {
    const m = await ready();
    const pause = button(m.el, "Pause");
    pause.click();
    expect(pause.textContent).toBe("Resume live");
    await tick(60000);
    expect(m.fetch.chart()).toHaveLength(1);

    pause.click();
    expect(pause.textContent).toBe("Pause");
    await settle();
    expect(m.fetch.chart()).toHaveLength(2);
    await tick(2000);
    expect(m.fetch.chart()).toHaveLength(3);
  });

  test("pausing while a request is in flight: when it finishes the chart updates but live refresh stays off", async () => {
    let release,
      n = 0;
    const m = mount({ compare: "" }, (c) => {
      if (isChart(c) && ++n === 2) {
        return new Promise((r) => {
          release = () =>
            r(
              dataResponse(
                "site_instantaneous",
                "1s",
                ["aggregate_active_power"],
                { meta: meta("aggregate_active_power") },
              ),
            );
        });
      }
      return undefined;
    });
    await settle();
    await tick(2000); // second chart request starts and stays pending
    expect(m.fetch.chart()).toHaveLength(2);

    button(m.el, "Pause").click(); // user pauses mid-request
    release();
    await settle();
    expect(plot(m).setData).toHaveBeenCalledTimes(1); // the in-flight reply is still drawn
    await tick(60000);
    expect(m.fetch.chart()).toHaveLength(2); // ...but nothing is scheduled afterwards
  });

  test("a hidden tab skips requests but keeps the schedule; becoming visible refreshes at once", async () => {
    const m = await ready();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    const tilesBefore = m.fetch.tiles().length;
    await tick(10000);
    expect(m.fetch.chart()).toHaveLength(1);
    expect(m.fetch.tiles()).toHaveLength(tilesBefore); // the tile loop pauses too

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(m.fetch.chart()).toHaveLength(2);
  });
});

describe("errors and recovery", () => {
  function flaky(failures, status, headers) {
    let n = 0;
    return (c) => {
      if (!isChart(c)) return undefined;
      n++;
      if (n <= failures)
        return jsonResponse({ error: "nope" }, status || 502, headers);
      return undefined;
    };
  }

  test("shows a retry message, then recovers with exponential back-off", async () => {
    const m = await ready({}, flaky(1));
    const msg = m.el.querySelector(".acewd-msg");
    expect(msg.textContent).toBe("Couldn’t load data – retrying…");
    expect(msg.classList.contains("show")).toBe(true);
    expect(m.uPlot.instances).toHaveLength(0);

    await tick(3999); // base 2 s x 2^1
    expect(m.fetch.chart()).toHaveLength(1);
    await tick(1);
    expect(m.fetch.chart()).toHaveLength(2);
    expect(msg.classList.contains("show")).toBe(false);
    expect(m.uPlot.instances).toHaveLength(1);
  });

  test("back-off doubles with each consecutive failure and resets after success", async () => {
    const m = await ready({}, flaky(2));
    await tick(4000); // 2nd attempt (fails again)
    expect(m.fetch.chart()).toHaveLength(2);
    await tick(7999); // 2 s x 2^2 = 8 s
    expect(m.fetch.chart()).toHaveLength(2);
    await tick(1);
    expect(m.fetch.chart()).toHaveLength(3); // succeeds
    await tick(2000); // back to the normal cadence
    expect(m.fetch.chart()).toHaveLength(4);
  });

  test('rate limiting shows a "busy" message and respects Retry-After', async () => {
    const m = await ready({}, flaky(1, 429, { "Retry-After": "30" }));
    expect(m.el.querySelector(".acewd-msg").textContent).toBe(
      "The data service is busy – retrying…",
    );
    await tick(29999);
    expect(m.fetch.chart()).toHaveLength(1);
    await tick(1);
    expect(m.fetch.chart()).toHaveLength(2);
  });

  test("a network error is handled like any other failure", async () => {
    let n = 0;
    const m = await ready({}, (c) => {
      if (isChart(c) && ++n === 1) throw new Error("offline");
    });
    expect(m.el.querySelector(".acewd-msg").textContent).toBe(
      "Couldn’t load data – retrying…",
    );
    await tick(4000);
    expect(m.uPlot.instances).toHaveLength(1);
  });
});

describe("changing selection while a request is in flight", () => {
  test("the stale reply is ignored and the newest selection is fetched and drawn", async () => {
    let release;
    let first = true;
    const m = mount({ compare: "" }, (c) => {
      if (isChart(c) && first) {
        first = false;
        return new Promise((r) => {
          release = () =>
            r(
              dataResponse(
                "site_instantaneous",
                "1s",
                ["aggregate_active_power"],
                { meta: meta("aggregate_active_power") },
              ),
            );
        });
      }
      return undefined;
    });
    await settle();
    expect(m.fetch.chart()).toHaveLength(1); // first request is pending

    choose(control(m.el, "Measurement"), "aggregate_wind_speed");
    await settle();
    expect(m.fetch.chart()).toHaveLength(1); // queued, not sent in parallel

    release();
    await settle();
    expect(m.fetch.chart()).toHaveLength(2);
    expect(m.fetch.chart()[1].params.fields).toBe("aggregate_wind_speed");
    expect(m.uPlot.instances).toHaveLength(1); // the stale data was never drawn
    expect(plot(m).opts.series[1].label).toBe("Wind speed (m/s)");
  });
});

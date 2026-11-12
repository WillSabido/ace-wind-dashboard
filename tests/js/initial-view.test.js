/** Getting a graph on screen at first load: cache-busting, visible failure causes, and self-widening. */
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
const chartCalls = (m) => m.fetch.chart();
const spans = (m) => chartCalls(m).map((c) => c.params.span);
const emptyFor = (c, fields) =>
  dataResponse(
    c.params.family,
    c.params.resolution,
    fields || c.params.fields.split(","),
    {
      rows: 0,
      timestamps: [],
      values: Object.fromEntries(
        (fields || c.params.fields.split(",")).map((f) => [f, []]),
      ),
    },
  );

describe("cache-busting: a moving window must never be served from a cache", () => {
  test("live chart and tile requests carry a per-second time bucket", async () => {
    const m = mount();
    await settle();
    expect(chartCalls(m)[0].bucket).toBe(NOW_S);
    m.fetch.tiles().forEach((c) => expect(c.bucket).toBe(NOW_S));
  });

  test("the bucket advances with every refresh, so each poll is a new URL", async () => {
    const m = mount({ liveRefresh: 2 });
    await settle();
    await tick(2000);
    await tick(2000);
    const buckets = chartCalls(m).map((c) => c.bucket);
    expect(buckets).toEqual([NOW_S, NOW_S + 2, NOW_S + 4]);
    expect(new Set(chartCalls(m).map((c) => c.url)).size).toBe(3);
  });

  test("changing the time period also gets a fresh URL", async () => {
    const m = mount();
    await settle();
    choose(control(m.el, "Time period"), 86400);
    await settle();
    const urls = chartCalls(m).map((c) => c.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  test("a fixed custom window is not bucketed (its URL is stable, so caching it is safe)", async () => {
    const m = mount();
    await settle();
    choose(control(m.el, "Time period"), "custom");
    control(m.el, "From").value = "2026-10-28T10:00";
    control(m.el, "To").value = "2026-10-28T12:00";
    button(m.el, "Show").click();
    await settle();
    const c = chartCalls(m).pop();
    expect(c.params.start).toBeDefined();
    expect(c.bucket).toBeUndefined();
  });

  test("the bucket is never one of the request parameters the server validates", async () => {
    const m = mount();
    await settle();
    expect(chartCalls(m)[0].params._b).toBeUndefined(); // helper moved it to .bucket
    expect(chartCalls(m)[0].url).toMatch(/[?&]_b=\d+/);
  });
});

describe("failures explain themselves", () => {
  test("HTTP errors show the status and the server message, and are logged for the console", async () => {
    const m = mount({}, (c) =>
      isChart(c)
        ? jsonResponse({ error: "The data service could not be reached." }, 502)
        : undefined,
    );
    await settle();
    expect(m.el.querySelector(".acewd-msg").textContent).toBe(
      "Couldn’t load data – retrying… (HTTP 502: The data service could not be reached.)",
    );
    expect(console.warn).toHaveBeenCalledWith(
      "[ACE dashboard] chart request failed:",
      "HTTP 502: The data service could not be reached.",
      expect.objectContaining({ family: "site_instantaneous" }),
    );
  });

  test("network failures show the browser's message", async () => {
    const m = mount({}, (c) => {
      if (isChart(c)) throw new TypeError("Failed to fetch");
    });
    await settle();
    expect(m.el.querySelector(".acewd-msg").textContent).toBe(
      "Couldn’t load data – retrying… (Failed to fetch)",
    );
  });

  test("a drawing error (not just a network error) is surfaced rather than hidden", async () => {
    const m = mount({}, undefined);
    await settle();
    m.uPlot.instances.length = 0;
    window.uPlot = function () {
      throw new Error("bad canvas");
    };
    window.uPlot.tzDate = (d) => d;
    window.uPlot.paths = {};
    choose(control(m.el, "Chart style"), "area");
    await settle();
    expect(m.el.querySelector(".acewd-msg").textContent).toContain(
      "bad canvas",
    );
  });

  test("live-reading failures are logged too", async () => {
    mount({}, (c) =>
      c.params && c.params.limit
        ? jsonResponse({ error: "x" }, 500)
        : undefined,
    );
    await settle();
    expect(console.warn).toHaveBeenCalledWith(
      "[ACE dashboard] live readings failed:",
      "HTTP 500: x",
    );
  });
});

describe("an empty default view widens itself", () => {
  /** Data exists only for spans of at least `minSpan` seconds. */
  const dataFrom = (minSpan) => (c) => {
    if (!isChart(c)) return undefined;
    return Number(c.params.span) >= minSpan ? undefined : emptyFor(c);
  };

  test("steps up through the presets until data appears, updating the menu", async () => {
    const m = mount({}, dataFrom(21600));
    await settle();
    expect(spans(m)).toEqual(["1800", "3600", "21600"]);
    expect(control(m.el, "Time period").value).toBe("21600");
    expect(m.uPlot.instances).toHaveLength(1);
    expect(m.el.querySelector(".acewd-msg").classList.contains("show")).toBe(
      false,
    );
    expect(m.el.querySelector(".acewd-note").textContent).toContain(
      "1-minute data",
    );
  });

  test("widens when the data exists but every value is null", async () => {
    const m = mount({ compare: "" }, (c) => {
      if (!isChart(c)) return undefined;
      if (c.params.span === "1800")
        return dataResponse(
          c.params.family,
          c.params.resolution,
          ["aggregate_active_power"],
          {
            values: { aggregate_active_power: [null, null, null] },
            meta: H.catalogue().families[0].fields.reduce((a, f) => {
              a[f.name] = f;
              return a;
            }, {}),
          },
        );
      return undefined;
    });
    await settle();
    expect(spans(m)).toEqual(["1800", "3600"]);
    expect(m.uPlot.instances).toHaveLength(1);
  });

  test("gives up after the longest available period and shows the normal message once", async () => {
    const m = mount({}, dataFrom(Infinity));
    await settle();
    expect(spans(m)).toEqual(["1800", "3600", "21600", "86400", "604800"]); // site data has no 30-day+ presets
    expect(m.uPlot.instances).toHaveLength(0);
    expect(m.el.querySelector(".acewd-msg").textContent).toBe(
      "No data available for this period.",
    );
    await tick(60000); // 1-minute data refreshes every minute
    expect(chartCalls(m).length).toBeGreaterThan(5); // live refresh carries on...
    expect(new Set(spans(m))).toEqual(
      new Set(["1800", "3600", "21600", "86400", "604800"]),
    ); // ...but does not widen again
  });

  test("skips presets the data set cannot serve", async () => {
    const m = mount(
      {
        family: "wec_availability",
        field: "availability",
        compare: "",
        range: 604800,
      },
      dataFrom(Infinity),
    );
    await settle();
    expect(spans(m)).toEqual(["604800", "2592000", "7776000", "31536000"]);
  });

  test("never widens after the visitor has chosen something themselves", async () => {
    const m = mount({}, (c) =>
      isChart(c) && c.params.span === "300" ? emptyFor(c) : undefined,
    );
    await settle();
    choose(control(m.el, "Time period"), 300);
    await settle();
    expect(spans(m)).toEqual(["1800", "300"]);
    expect(m.el.querySelector(".acewd-msg").textContent).toBe(
      "No data available for this period.",
    );
    expect(control(m.el, "Time period").value).toBe("300");
  });

  test("never widens when the visitor chose a period while the first request was still loading", async () => {
    let release;
    let first = true;
    const m = mount({}, (c) => {
      if (!isChart(c)) return undefined;
      if (first) {
        first = false;
        return new Promise((r) => {
          release = () => r(emptyFor(c));
        });
      }
      return emptyFor(c); // everything is empty
    });
    await settle();
    choose(control(m.el, "Time period"), 300); // before anything has been drawn
    await settle();
    release();
    await settle();
    expect(spans(m)).toEqual(["1800", "300"]); // no widening beyond the visitor's choice
    expect(control(m.el, "Time period").value).toBe("300");
    expect(m.el.querySelector(".acewd-msg").textContent).toBe(
      "No data available for this period.",
    );
  });

  test("a Show click on a custom window before anything has drawn also ends widening", async () => {
    let first = true;
    let release;
    const m = mount({}, (c) => {
      if (!isChart(c)) return undefined;
      if (first) {
        first = false;
        return new Promise((r) => {
          release = () => r(emptyFor(c));
        });
      }
      return emptyFor(c);
    });
    await settle();
    choose(control(m.el, "Time period"), "custom");
    control(m.el, "From").value = "2026-10-28T10:00";
    control(m.el, "To").value = "2026-10-28T12:00";
    button(m.el, "Show").click();
    release();
    await settle();
    expect(chartCalls(m)).toHaveLength(2);
    expect(chartCalls(m)[1].params.start).toBeDefined();
  });

  test("never widens once a chart has been drawn (later gaps show the normal message)", async () => {
    let empty = false;
    const m = mount({}, (c) => (isChart(c) && empty ? emptyFor(c) : undefined));
    await settle();
    empty = true;
    await tick(2000);
    expect(spans(m)).toEqual(["1800", "1800"]);
    expect(m.el.querySelector(".acewd-msg").textContent).toBe(
      "No data available for this period.",
    );
  });

  test("does not widen a custom window", async () => {
    const m = mount({}, (c) =>
      isChart(c) && c.params.start ? emptyFor(c) : undefined,
    );
    await settle();
    choose(control(m.el, "Time period"), "custom");
    control(m.el, "From").value = "2026-10-28T10:00";
    control(m.el, "To").value = "2026-10-28T12:00";
    button(m.el, "Show").click();
    await settle();
    expect(chartCalls(m)).toHaveLength(2);
    expect(m.el.querySelector(".acewd-msg").textContent).toBe(
      "No data available for this period.",
    );
  });

  test("does not widen when the first request fails (that is retried as-is, with the reason shown)", async () => {
    let n = 0;
    const m = mount({}, (c) =>
      isChart(c) && ++n === 1 ? jsonResponse({ error: "x" }, 502) : undefined,
    );
    await settle();
    expect(spans(m)).toEqual(["1800"]);
    await tick(4000);
    expect(spans(m)).toEqual(["1800", "1800"]);
    expect(m.uPlot.instances).toHaveLength(1);
  });
});

describe("the default view with healthy data", () => {
  test("draws on first load with no interaction at all", async () => {
    const m = mount();
    await settle();
    expect(m.uPlot.instances).toHaveLength(1);
    expect(m.uPlot.instances[0].data[0].length).toBeGreaterThan(0);
    expect(m.el.querySelector(".acewd-msg").classList.contains("show")).toBe(
      false,
    );
    expect(chartCalls(m)).toHaveLength(1);
  });

  test("the chart and the tiles are independent: either can fail without blanking the other", async () => {
    let m = mount({}, (c) =>
      c.params && c.params.limit
        ? jsonResponse({ error: "x" }, 500)
        : undefined,
    );
    await settle();
    expect(m.uPlot.instances).toHaveLength(1);

    m = mount({}, (c) =>
      isChart(c) ? jsonResponse({ error: "x" }, 500) : undefined,
    );
    await settle();
    expect(m.el.querySelector(".acewd-tile .acewd-val").textContent).toBe(
      "14kW",
    ); // newest of the five default readings
  });
});

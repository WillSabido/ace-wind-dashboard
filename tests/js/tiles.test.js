/** Live summary tiles and the status chip. */
const H = require("./helpers");
const { mount, settle, tick, jsonResponse, dataResponse, catalogue, NOW_S } = H;

/** Build a handler that answers tile requests (limit=5) with the given latest readings. */
function readings(o) {
  o = Object.assign(
    { power: 1234.4, wind: 5, dir: 22, rotor: 12.34, age: 0 },
    o,
  );
  const col = (v) => (Array.isArray(v) ? v : [null, null, null, null, v]);
  return (c) => {
    if (c.path !== "data" || !c.params.limit) return undefined;
    const base = { rows: 5, end: NOW_S - o.age };
    if (c.params.family === "site_instantaneous") {
      return dataResponse(
        "site_instantaneous",
        "1s",
        [
          "aggregate_active_power",
          "aggregate_wind_speed",
          "aggregate_wind_direction",
        ],
        Object.assign(base, {
          values: {
            aggregate_active_power: col(o.power),
            aggregate_wind_speed: col(o.wind),
            aggregate_wind_direction: col(o.dir),
          },
        }),
      );
    }
    if (c.params.family === "wec_instantaneous") {
      return dataResponse(
        "wec_instantaneous",
        "1s",
        ["wec_rotor_speed"],
        Object.assign(base, { values: { wec_rotor_speed: col(o.rotor) } }),
      );
    }
  };
}

const TILE = { power: 0, wind: 1, dir: 2, rotor: 3 };
function tile(m, name) {
  const t = m.el.querySelectorAll(".acewd-tile")[TILE[name]];
  return {
    val: t.querySelector(".acewd-val"),
    number: t.querySelector(".acewd-val").firstChild.textContent,
    unit: (t.querySelector(".acewd-val small") || {}).textContent,
    sub: t.querySelector(".acewd-sub").textContent,
    el: t,
  };
}
const chip = (m) => m.el.querySelector(".acewd-chip");
const siteTiles = (m) =>
  m.fetch.tiles().filter((c) => c.params.family === "site_instantaneous");

async function ready(over, cfg) {
  const m = mount(cfg, readings(over));
  await settle();
  return m;
}

describe("requests", () => {
  test("asks for the newest few 1-second readings from the site and from the turbine", async () => {
    const m = await ready();
    const calls = m.fetch.tiles().map((c) => c.params);
    expect(calls).toContainEqual({
      family: "site_instantaneous",
      resolution: "1s",
      limit: "5",
      fields:
        "aggregate_active_power,aggregate_wind_speed,aggregate_wind_direction",
    });
    expect(calls).toContainEqual({
      family: "wec_instantaneous",
      resolution: "1s",
      limit: "5",
      asset: "wec1",
      fields: "wec_rotor_speed",
    });
  });

  test("does not request data sets the catalogue lacks, and copes without them", async () => {
    const cat = catalogue();
    cat.families = cat.families.filter((f) => f.family !== "wec_instantaneous");
    const m = mount({}, (c) => (c.path === "catalogue" ? cat : readings()(c)));
    await settle();
    expect(
      m.fetch.tiles().filter((c) => c.params.family === "wec_instantaneous"),
    ).toHaveLength(0);
    expect(tile(m, "power").number).toBe("1,234");
    expect(tile(m, "rotor").number).toBe("–");
  });

  test("with no site data set at all the tiles stay blank and the chip says so", async () => {
    const cat = catalogue();
    cat.families = cat.families.filter((f) => f.family === "wec_instantaneous");
    const m = mount(
      { family: "wec_instantaneous", field: "wec_rotor_speed", compare: "" },
      (c) => (c.path === "catalogue" ? cat : readings()(c)),
    );
    await settle();
    expect(siteTiles(m)).toHaveLength(0);
    expect(tile(m, "power").number).toBe("–");
    expect(tile(m, "rotor").number).toBe("12.3");
  });
});

describe("values", () => {
  test("power: kW with thousands separator, percentage of rated output, and a gauge", async () => {
    const m = await ready({ power: 1234.4 });
    const t = tile(m, "power");
    expect(t.number).toBe("1,234");
    expect(t.unit).toBe("kW");
    expect(t.sub).toBe("29% of 4.2 MW rated output");
    expect(
      parseFloat(m.el.querySelector(".acewd-bar i").style.width),
    ).toBeCloseTo(29.39, 1);
  });

  test("rated power setting drives the percentage", async () => {
    const m = await ready({ power: 1000 }, { ratedKw: 2000 });
    expect(tile(m, "power").sub).toBe("50% of 2 MW rated output");
  });

  test("the gauge is clamped between 0 and 100 %", async () => {
    let m = await ready({ power: 9000 });
    expect(m.el.querySelector(".acewd-bar i").style.width).toBe("100%");
    m = await ready({ power: -30 });
    expect(m.el.querySelector(".acewd-bar i").style.width).toBe("0%");
  });

  test("wind speed in m/s with mph conversion", async () => {
    const t = tile(await ready({ wind: 5 }), "wind");
    expect(t.number).toBe("5");
    expect(t.unit).toBe("m/s");
    expect(t.sub).toBe("11.2 mph");
  });

  test.each([
    [22, "NNE", 202],
    [0, "N", 180],
    [90, "E", 270],
    [180, "S", 360],
    [359, "N", 539],
    [-90, "W", 450],
    [725, "N", 185],
  ])(
    "wind direction %p° is %s, with the arrow pointing downwind (rotate %pdeg)",
    async (deg, name, rot) => {
      const m = await ready({ dir: deg });
      const t = tile(m, "dir");
      expect(t.val.textContent).toContain(name);
      expect(t.sub).toBe("Wind blowing from the " + name);
      expect(t.val.querySelector(".acewd-arrow").style.transform).toBe(
        "rotate(" + rot + "deg)",
      );
    },
  );

  test("direction shows normalised degrees", async () => {
    const t = tile(await ready({ dir: -90 }), "dir");
    expect(t.unit).toBe("270°");
  });

  test("rotor speed in rpm, turning or stationary", async () => {
    let t = tile(await ready({ rotor: 12.34 }), "rotor");
    expect([t.number, t.unit, t.sub]).toEqual(["12.3", "rpm", "Rotor turning"]);
    t = tile(await ready({ rotor: 0.2 }), "rotor");
    expect(t.sub).toBe("Rotor stationary");
  });

  test("uses the newest non-null reading in each series", async () => {
    const m = await ready({
      power: [100, 200, null, null, null],
      wind: [1, 2, 3, null, null],
    });
    expect(tile(m, "power").number).toBe("200");
    expect(tile(m, "wind").number).toBe("3");
  });

  test("a reading of zero is shown, not treated as missing", async () => {
    const m = await ready({ power: 0, wind: 0 });
    expect(tile(m, "power").number).toBe("0");
    expect(tile(m, "wind").number).toBe("0");
  });
});

describe("status chip", () => {
  test("generating and fresh", async () => {
    const c = chip(await ready({ power: 100 }));
    expect(c.textContent).toBe("Generating · updated 12:00:00");
    expect(c.classList.contains("on")).toBe(true);
  });

  test("not generating at or below 5 kW", async () => {
    let c = chip(await ready({ power: 5 }));
    expect(c.textContent).toBe("Not generating · updated 12:00:00");
    expect(c.classList.contains("on")).toBe(false);
    c = chip(await ready({ power: -2 }));
    expect(c.textContent).toMatch(/^Not generating/);
  });

  test("data older than 3 minutes is flagged as delayed, with the last reading time", async () => {
    const c = chip(await ready({ age: 200 }));
    expect(c.textContent).toBe("Data delayed – last reading 11:56");
    expect(c.classList.contains("warn")).toBe(true);
  });

  test("exactly 3 minutes old is still considered live", async () => {
    expect(chip(await ready({ age: 180 })).classList.contains("warn")).toBe(
      false,
    );
    expect(chip(await ready({ age: 181 })).classList.contains("warn")).toBe(
      true,
    );
  });

  test("all-null readings say there is no recent data", async () => {
    const c = chip(
      await ready({ power: null, wind: null, dir: null, rotor: null }),
    );
    expect(c.textContent).toBe("No recent data");
    expect(c.classList.contains("warn")).toBe(true);
  });

  test("a failed request says data is unavailable", async () => {
    const m = mount({}, (c) =>
      c.params && c.params.limit
        ? jsonResponse({ error: "x" }, 500)
        : undefined,
    );
    await settle();
    expect(chip(m).textContent).toBe("Data unavailable");
    expect(chip(m).classList.contains("warn")).toBe(true);
  });

  test("the chip works even when the tiles are hidden", async () => {
    const m = await ready({ power: 100 }, { tiles: false });
    expect(chip(m).textContent).toBe("Generating · updated 12:00:00");
  });

  test("time is shown in the configured time zone", async () => {
    const m = await ready({ power: 100 }, { tz: "Asia/Tokyo" });
    expect(chip(m).textContent).toBe("Generating · updated 21:00:00");
  });
});

describe("refresh loop", () => {
  test("refreshes every liveRefresh seconds", async () => {
    const m = await ready({}, { liveRefresh: 5 });
    expect(siteTiles(m)).toHaveLength(1);
    await tick(4999);
    expect(siteTiles(m)).toHaveLength(1);
    await tick(1);
    expect(siteTiles(m)).toHaveLength(2);
  });

  test("tiles update with new readings", async () => {
    let power = 100;
    const m = mount({}, (c) => readings({ power })(c));
    await settle();
    expect(tile(m, "power").number).toBe("100");
    power = 250;
    await tick(2000);
    expect(tile(m, "power").number).toBe("250");
  });

  test("failures back off exponentially, then recover", async () => {
    let fail = 2;
    const m = mount({}, (c) => {
      if (
        c.params &&
        c.params.limit &&
        c.params.family === "site_instantaneous" &&
        fail > 0
      ) {
        fail--;
        return jsonResponse({ error: "x" }, 500);
      }
      return readings()(c);
    });
    await settle();
    expect(siteTiles(m)).toHaveLength(1);
    await tick(3999); // 2 s x 2^1
    expect(siteTiles(m)).toHaveLength(1);
    await tick(1);
    expect(siteTiles(m)).toHaveLength(2); // fails again
    await tick(7999); // 2 s x 2^2
    expect(siteTiles(m)).toHaveLength(2);
    await tick(1);
    expect(siteTiles(m)).toHaveLength(3); // succeeds
    expect(chip(m).textContent).toMatch(/Generating/);
    await tick(2000);
    expect(siteTiles(m)).toHaveLength(4); // normal cadence again
  });

  test("honours Retry-After from a rate-limited response", async () => {
    let limited = true;
    const m = mount({}, (c) => {
      if (c.params && c.params.limit && limited) {
        limited = false;
        return jsonResponse({ error: "busy" }, 429, { "Retry-After": "30" });
      }
      return readings()(c);
    });
    await settle();
    await tick(29999);
    expect(siteTiles(m)).toHaveLength(1);
    await tick(1);
    expect(siteTiles(m)).toHaveLength(2);
  });

  test("a failing turbine request does not blank the site tiles", async () => {
    const m = mount({}, (c) =>
      c.params && c.params.family === "wec_instantaneous" && c.params.limit
        ? jsonResponse({ error: "x" }, 500)
        : readings()(c),
    );
    await settle();
    expect(tile(m, "power").number).toBe("1,234");
    expect(tile(m, "rotor").number).toBe("–");
    expect(chip(m).textContent).toMatch(/Generating/);
  });

  test("pauses while the tab is hidden and resumes immediately when it is shown again", async () => {
    const m = await ready();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    await tick(10000);
    expect(siteTiles(m)).toHaveLength(1);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(siteTiles(m)).toHaveLength(2);
    await tick(2000);
    expect(siteTiles(m)).toHaveLength(3); // the loop is running again
  });
});

/** Pure helpers exported by the script for testing. */
const { NOW_S, res } = require("./helpers");
document.body.innerHTML = ""; // nothing to initialise
const { pickRes, nf, clock, lastVal } = require("../../assets/js/dashboard.js");

const SITE = [res("1s", 1), res("60s", 60)];
const STATS = [res("60s", 60), res("10m", 600), res("daily", 86400)];
const DAILY = [res("daily", 86400)];
const HOUR = 3600,
  DAY = 86400;

describe("pickRes (choose a data resolution for a time span)", () => {
  const spans = [
    300,
    1800,
    HOUR,
    6 * HOUR,
    DAY,
    7 * DAY,
    30 * DAY,
    90 * DAY,
    365 * DAY,
  ];
  const name = (list, s) => {
    const r = pickRes(list, s);
    return r ? r.resolution : null;
  };

  test("1s/60s data set: live detail for short spans, minutes for a day or a week, nothing beyond ~8 days", () => {
    expect(spans.map((s) => name(SITE, s))).toEqual([
      "1s",
      "1s",
      "60s",
      "60s",
      "60s",
      "60s",
      null,
      null,
      null,
    ]);
  });

  test("statistics data set: 1-minute, then 10-minute, then daily as the span grows", () => {
    expect(spans.map((s) => name(STATS, s))).toEqual([
      "60s",
      "60s",
      "60s",
      "60s",
      "60s",
      "10m",
      "10m",
      "daily",
      "daily",
    ]);
  });

  test("daily-only data set is unavailable for spans shorter than two days", () => {
    expect(spans.map((s) => name(DAILY, s))).toEqual([
      null,
      null,
      null,
      null,
      null,
      "daily",
      "daily",
      "daily",
      "daily",
    ]);
  });

  test('uses the finest resolution that fits in 2000 points (the API\'s single-call "latest" limit)', () => {
    expect(name(SITE, 2000)).toBe("1s");
    expect(name([res("1s", 1), res("600s", 600)], 2000)).toBe("1s");
  });

  test("the 5000-point ceiling for stepping down to finer data is exact", () => {
    const gap = [res("1s", 1), res("600s", 600)]; // big gap so the ceiling, not the 60-point floor, decides
    expect(name(gap, 5000)).toBe("1s");
    expect(name(gap, 5001)).toBe("600s");
  });

  test("if the coarse choice would give fewer than 60 points, steps down to a finer one (up to 5000 points)", () => {
    expect(name(SITE, 3000)).toBe("1s"); // 60s = 50 pts -> use 1s (3000 pts)
    expect(name(SITE, 3600)).toBe("60s"); // 60s = 60 pts is enough
    expect(name(STATS, 30 * DAY)).toBe("10m"); // daily = 30 pts -> 10m (4320 pts)
    expect(name(STATS, 90 * DAY)).toBe("daily"); // 10m would be 12960 pts: too many
  });

  test("falls back to the coarsest resolution up to a hard cap of 12000 points", () => {
    expect(name([res("60s", 60)], 12000 * 60)).toBe("60s");
    expect(pickRes([res("60s", 60)], 12000 * 60 + 60)).toBeNull();
  });

  test("requires at least two points", () => {
    expect(pickRes(DAILY, DAY)).toBeNull();
    expect(pickRes(DAILY, 2 * DAY)).not.toBeNull();
  });

  test("returns the object from the list (so callers can read seconds/refresh)", () => {
    expect(pickRes(SITE, 300)).toBe(SITE[0]);
  });
});

describe("nf (number formatting)", () => {
  test.each([
    [1234.567, 0, "1,235"],
    [1234.567, 1, "1,234.6"],
    [0, 0, "0"],
    [-5.25, 1, "-5.3"],
    [1000000, 0, "1,000,000"],
    ["12.5", 1, "12.5"],
  ])("nf(%p, %p) = %p", (v, dp, out) => expect(nf(v, dp)).toBe(out));

  test.each([[null], [undefined], [NaN], ["abc"]])(
    "nf(%p) is an en dash",
    (v) => expect(nf(v, 1)).toBe("–"),
  );
});

describe("clock (time of day in the site time zone)", () => {
  test("formats with and without seconds", () => {
    expect(clock(NOW_S, "UTC", true)).toBe("12:00:00");
    expect(clock(NOW_S, "UTC", false)).toBe("12:00");
  });
  test("honours the time zone", () => {
    expect(clock(NOW_S, "Asia/Tokyo", true)).toBe("21:00:00");
    expect(clock(NOW_S, "America/New_York", false)).toBe("08:00");
  });
  test("an invalid zone does not throw", () => {
    expect(typeof clock(NOW_S, "Mars/Olympus", true)).toBe("string");
  });
});

describe("lastVal (newest non-null reading)", () => {
  const d = {
    timestamps: [10, 20, 30, 40],
    series: { a: [1, 2, null, null], b: [null, null, null, null] },
  };
  test("returns the newest non-null value with its timestamp", () =>
    expect(lastVal(d, "a")).toEqual({ v: 2, t: 20 }));
  test("keeps zero as a real value", () =>
    expect(lastVal({ timestamps: [1, 2], series: { a: [5, 0] } }, "a")).toEqual(
      { v: 0, t: 2 },
    ));
  test("null when everything is null", () =>
    expect(lastVal(d, "b")).toBeNull());
  test("null for missing response, series or field", () => {
    expect(lastVal(null, "a")).toBeNull();
    expect(lastVal({}, "a")).toBeNull();
    expect(lastVal(d, "zzz")).toBeNull();
  });
});

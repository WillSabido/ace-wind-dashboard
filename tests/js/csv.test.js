/** "Download CSV" */
const H = require("./helpers");
const { mount, settle, tick, button, dataResponse, catalogue, fld, NOW_S } = H;

let blobs, downloads, OrigBlob;

beforeEach(() => {
  blobs = [];
  downloads = [];
  OrigBlob = global.Blob;
  global.Blob = class extends OrigBlob {
    constructor(parts, opts) {
      super(parts, opts);
      this.parts = parts;
      this.opts = opts;
      blobs.push(this);
    }
  };
  URL.createObjectURL = jest.fn(() => "blob:fake");
  URL.revokeObjectURL = jest.fn();
  jest
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function () {
      downloads.push({ href: this.href, download: this.download });
    });
});
afterEach(() => {
  global.Blob = OrigBlob;
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

const iso = (s) => new Date(s * 1000).toISOString();
const csvLines = () => blobs[0].parts.join("").split("\n");

describe("CSV export", () => {
  test("downloads what is on the chart, with a licence line, header row and ISO UTC times", async () => {
    const m = mount();
    await settle();
    button(m.el, "Download CSV").click();

    expect(blobs).toHaveLength(1);
    expect(blobs[0].opts).toEqual({ type: "text/csv" });
    expect(csvLines()).toEqual([
      "# Source: Ambition Community Energy (ACE) - ACE Wind Turbine Data, CC BY 4.0, https://doi.org/10.5281/zenodo.22662372",
      'Time (UTC),"Total active power (kW)","Wind speed (m/s)"',
      iso(NOW_S - 2) + ",10,20",
      iso(NOW_S - 1) + ",11,21",
      iso(NOW_S) + ",12,22",
    ]);
  });

  test("the file is named for the data set and first measurement and is offered via a temporary link", async () => {
    const m = mount();
    await settle();
    button(m.el, "Download CSV").click();
    expect(downloads).toEqual([
      {
        href: "blob:fake",
        download: "ace-wind-site_instantaneous-aggregate_active_power.csv",
      },
    ]);
    expect(document.querySelector("a[download]")).toBeNull(); // link is removed again
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await tick(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  test("gaps are empty cells, and quotes in labels are escaped", async () => {
    const m = mount({ compare: "" }, (c) => {
      if (c.path !== "data" || c.params.limit) return undefined;
      return dataResponse(
        "site_instantaneous",
        "1s",
        ["aggregate_active_power"],
        {
          values: { aggregate_active_power: [1.5, null, 0] },
          meta: {
            aggregate_active_power: fld(
              "aggregate_active_power",
              'Power "peak"',
              "kW",
            ),
          },
        },
      );
    });
    await settle();
    button(m.el, "Download CSV").click();
    const lines = csvLines();
    expect(lines[1]).toBe('Time (UTC),"Power ""peak"" (kW)"');
    expect(lines[2].endsWith(",1.5")).toBe(true);
    expect(lines[3].endsWith(",")).toBe(true);
    expect(lines[4].endsWith(",0")).toBe(true);
  });

  test("follows the current selection", async () => {
    const m = mount();
    await settle();
    const sel = m.el.querySelector(
      "#" +
        Array.from(m.el.querySelectorAll("label"))
          .find((l) => l.textContent === "Compare with")
          .getAttribute("for"),
    );
    sel.value = "";
    sel.dispatchEvent(new Event("change"));
    await settle();
    button(m.el, "Download CSV").click();
    expect(csvLines()[1]).toBe('Time (UTC),"Total active power (kW)"');
  });

  test("does nothing when there is no data to export", async () => {
    const m = mount({ compare: "" }, (c) =>
      c.path === "data" && !c.params.limit
        ? dataResponse("site_instantaneous", "1s", ["aggregate_active_power"], {
            rows: 0,
            timestamps: [],
            values: { aggregate_active_power: [] },
          })
        : undefined,
    );
    await settle();
    button(m.el, "Download CSV").click();
    expect(blobs).toHaveLength(0);
    expect(downloads).toHaveLength(0);
  });
});

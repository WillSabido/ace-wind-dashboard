/** Building the dashboard from the shortcode container. */
const H = require("./helpers");
const { mount, settle, jsonResponse, catalogue } = H;

describe("initialisation", () => {
  test("replaces the loading text with the title, status chip, tiles, controls, chart and footer", async () => {
    const { el } = mount();
    expect(el.querySelector(".acewd-loading")).not.toBeNull(); // before data arrives
    await settle();
    expect(el.querySelector(".acewd-loading")).toBeNull();
    expect(el.querySelector(".acewd-title").textContent).toBe(
      "Our wind turbine – live data",
    );
    expect(el.querySelector(".acewd-chip")).not.toBeNull();
    expect(el.querySelectorAll(".acewd-tile")).toHaveLength(4);
    expect(el.querySelectorAll(".acewd-controls select")).toHaveLength(6);
    expect(el.querySelector(".acewd-chart")).not.toBeNull();
    expect(el.querySelector(".acewd-foot")).not.toBeNull();
  });

  test("tile headings", async () => {
    const { el } = mount();
    await settle();
    expect(
      Array.from(el.querySelectorAll(".acewd-tile h3")).map(
        (h) => h.textContent,
      ),
    ).toEqual(["Power output", "Wind speed", "Wind direction", "Rotor speed"]);
  });

  test("footer carries the licence and citation required by the data set", async () => {
    const { el } = mount();
    await settle();
    const foot = el.querySelector(".acewd-foot");
    const links = Array.from(foot.querySelectorAll("a"));
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://creativecommons.org/licenses/by/4.0/");
    expect(hrefs).toContain("https://doi.org/10.5281/zenodo.22662372");
    expect(foot.textContent).toMatch(/CC BY 4\.0/);
    expect(foot.textContent).toMatch(/doi:10\.5281\/zenodo\.22662372/);
    links.forEach((a) => {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    });
  });

  test("tiles:false hides the tiles but keeps the chart", async () => {
    const { el, fetch } = mount({ tiles: false });
    await settle();
    expect(el.querySelector(".acewd-tiles")).toBeNull();
    expect(el.querySelector(".acewd-val")).toBeNull();
    expect(el.querySelector(".acewd-controls")).not.toBeNull();
    expect(fetch.chart().length).toBe(1);
  });

  test("controls:false hides the menus; the chart still loads with the configured selections", async () => {
    const { el, fetch, uPlot } = mount({ controls: false });
    await settle();
    expect(el.querySelector(".acewd-controls")).toBeNull();
    expect(el.querySelectorAll("select")).toHaveLength(0);
    expect(fetch.chart()[0].params).toMatchObject({
      family: "site_instantaneous",
      fields: "aggregate_active_power,aggregate_wind_speed",
      span: "1800",
    });
    expect(uPlot.instances).toHaveLength(1);
    expect(el.querySelector(".acewd-bottom")).not.toBeNull(); // Pause / CSV still available
  });

  test("chart is created with the configured height", async () => {
    const { uPlot } = mount({ height: 555 });
    await settle();
    expect(uPlot.instances[0].opts.height).toBe(555);
  });

  test("every menu has a visible label wired to it, and status regions are announced", async () => {
    const { el } = mount();
    await settle();
    el.querySelectorAll(
      ".acewd-controls select, .acewd-controls input",
    ).forEach((c) => {
      const label = el.querySelector('label[for="' + c.id + '"]');
      expect(label).not.toBeNull();
      expect(label.textContent.length).toBeGreaterThan(0);
    });
    expect(el.querySelector(".acewd-chip").getAttribute("role")).toBe("status");
    expect(el.querySelector(".acewd-msg").getAttribute("role")).toBe("status");
  });

  test("the labels are the six menus the page promises", async () => {
    const { el } = mount();
    await settle();
    expect(
      Array.from(
        el.querySelectorAll(".acewd-controls > .acewd-ctl > label"),
      ).map((l) => l.textContent),
    ).toEqual([
      "Data",
      "Turbine / unit",
      "Measurement",
      "Compare with",
      "Time period",
      "Chart style",
    ]);
  });
});

describe("when the data service is unavailable", () => {
  test("shows a friendly error with the server message when the catalogue returns an error", async () => {
    const { el, fetch } = mount({}, (c) =>
      c.path === "catalogue"
        ? jsonResponse({ error: "Upstream is down" }, 502)
        : undefined,
    );
    await settle();
    const err = el.querySelector(".acewd-error");
    expect(err).not.toBeNull();
    expect(err.textContent).toMatch(/temporarily unavailable/i);
    expect(err.textContent).toContain("Upstream is down");
    expect(el.querySelector(".acewd-loading")).toBeNull();
    expect(fetch.data()).toHaveLength(0);
  });

  test("shows the error when the network request itself fails", async () => {
    const { el } = mount({}, (c) => {
      if (c.path === "catalogue") throw new Error("Failed to fetch");
    });
    await settle();
    expect(el.querySelector(".acewd-error").textContent).toContain(
      "Failed to fetch",
    );
  });

  test("dashboards created together share one failed catalogue request", async () => {
    const { els, fetch } = mount([{}, {}], (c) =>
      c.path === "catalogue" ? jsonResponse({ error: "blip" }, 502) : undefined,
    );
    await settle();
    expect(fetch.calls.filter((c) => c.path === "catalogue")).toHaveLength(1);
    expect(els.every((e) => e.querySelector(".acewd-error"))).toBe(true);
  });

  test("a failed catalogue is not cached: a dashboard created later retries and succeeds", async () => {
    let n = 0;
    const { el, fetch, api } = mount({}, (c) => {
      if (c.path !== "catalogue") return undefined;
      return ++n === 1 ? jsonResponse({ error: "blip" }, 502) : catalogue();
    });
    await settle();
    expect(el.querySelector(".acewd-error")).not.toBeNull();

    const el2 = document.createElement("div");
    el2.className = "acewd";
    el2.setAttribute("data-config", JSON.stringify(H.DEFAULT_CFG));
    document.body.appendChild(el2);
    new api.Dash(el2);
    await settle();
    expect(fetch.calls.filter((c) => c.path === "catalogue")).toHaveLength(2);
    expect(el2.querySelector(".acewd-error")).toBeNull();
    expect(el2.querySelector(".acewd-title")).not.toBeNull();
  });
});

describe("multiple dashboards on one page", () => {
  test("share one catalogue request but each draws its own chart", async () => {
    const { els, fetch, uPlot } = mount([{}, { title: "Second" }]);
    await settle();
    expect(fetch.calls.filter((c) => c.path === "catalogue")).toHaveLength(1);
    expect(els.map((e) => e.querySelector(".acewd-title").textContent)).toEqual(
      ["Our wind turbine – live data", "Second"],
    );
    expect(uPlot.instances).toHaveLength(2);
    expect(els[0].querySelector(".acewd-chart")).not.toBe(
      els[1].querySelector(".acewd-chart"),
    );
  });

  test("control ids are unique so labels never point at the wrong dashboard", async () => {
    const { els } = mount([{}, {}]);
    await settle();
    const ids = Array.from(document.querySelectorAll("select")).map(
      (s) => s.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

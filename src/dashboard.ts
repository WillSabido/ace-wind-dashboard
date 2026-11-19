import type uPlot from "uplot";
import { catalogue, errorInfo, request } from "./api";
import { explainError } from "./errors";
import type { Explained } from "./errors";
import type { Params } from "./api";
import {
  ARROW,
  COLORS,
  COMPASS,
  DOI,
  GENERATING_KW,
  MPS_TO_MPH,
  RANGES,
  RES_NAMES,
  STALE_AFTER_S,
  STYLES,
} from "./constants";
import type {
  Catalogue,
  ChartData,
  ChartStyle,
  Config,
  DataResponse,
  Family,
  FieldInfo,
  Resolution,
  State,
} from "./types";
import {
  clock,
  fieldLabel,
  h,
  lastVal,
  nf,
  nowSeconds,
  pickRes,
  uid,
} from "./util";

/* ---------- view-model pieces ---------- */

interface Tile {
  v: HTMLElement;
  s: HTMLElement;
}

interface Tiles {
  power: Tile;
  wind: Tile;
  dir: Tile;
  rotor: Tile;
  bar: HTMLElement;
}

interface Controls {
  family: HTMLSelectElement;
  asset: HTMLSelectElement;
  assetWrap: HTMLElement;
  f1: HTMLSelectElement;
  f2: HTMLSelectElement;
  range: HTMLSelectElement;
  style: HTMLSelectElement;
  cs: HTMLInputElement;
  ce: HTMLInputElement;
  custom: HTMLElement;
}

/** "HTTP 502: message" / "message", for the on-screen note and the console. */
const describe = (info: {
  message: string;
  status: number | undefined;
}): string =>
  info.status
    ? "HTTP " + info.status + (info.message ? ": " + info.message : "")
    : info.message;

/** Plain ISO-8601 UTC without milliseconds, as the REST proxy expects. */
const isoSeconds = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toISOString().replace(/\.\d+Z$/, "Z");

/** Value for an <input type="datetime-local"> in the visitor's local time. */
const localInputValue = (d: Date): string =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

/* ---------- dashboard ---------- */

export class Dash {
  private readonly el: HTMLElement;
  private readonly cfg: Config;
  private readonly st: State;
  private cat!: Catalogue;

  // Elements created in build().
  private chip!: HTMLElement;
  private chartEl!: HTMLElement;
  private msg!: HTMLElement;
  private note!: HTMLElement;
  private liveBtn!: HTMLButtonElement;
  private tiles: Tiles | null = null;
  private ctl: Controls | null = null;

  // Chart state.
  private plot: uPlot | null = null;
  private sig = "";
  private last: ChartData | null = null;
  private timer: number | undefined;
  private busy = false;
  private pending = false;
  private fail = 0;
  private retryAfter = 0;
  /** Until the user touches a control or a chart has been drawn, an empty default view widens itself. */
  private autoWiden = true;
  /** Set when the data service rejected the current selection; stops retrying until the visitor changes something. */
  private noRetry = false;

  // Tile loop state.
  private tileTimer: number | undefined;
  private tileFail = 0;
  private tileDelay = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    this.cfg = JSON.parse(el.getAttribute("data-config") || "{}") as Config;
    this.st = {
      family: "",
      asset: null,
      f1: "",
      f2: "",
      range: this.cfg.range,
      style: "line",
      live: true,
      cStart: null,
      cEnd: null,
    };

    catalogue(this.cfg.rest).then(
      (cat) => {
        this.cat = cat;
        this.build();
      },
      (e: unknown) => {
        el.innerHTML = "";
        el.appendChild(
          h("p", {
            class: "acewd-error",
            text:
              "The turbine dashboard is temporarily unavailable. " +
              errorInfo(e).message,
          }),
        );
      },
    );
  }

  /* ---------- lookups ---------- */

  private fam(): Family {
    const f = this.famByName(this.st.family);
    if (!f) throw new Error("Unknown data set: " + this.st.family);
    return f;
  }

  private famByName(name: string): Family | null {
    return this.cat.families.find((f) => f.family === name) || null;
  }

  /* ---------- building the UI ---------- */

  private build(): void {
    const c = this.cfg;
    const el = this.el;
    const st = this.st;
    el.innerHTML = "";

    // Initial selections (fall back gracefully if the API changes).
    const f0 = this.famByName(c.family) || this.cat.families[0];
    const names = f0.fields.map((f) => f.name);
    st.family = f0.family;
    st.asset = f0.assets[0] || null;
    st.f1 = names.indexOf(c.field) >= 0 ? c.field : names[0];
    st.f2 =
      c.compare && c.compare !== st.f1 && names.indexOf(c.compare) >= 0
        ? c.compare
        : "";

    // Header
    this.chip = h("span", {
      class: "acewd-chip",
      text: "Connecting…",
      role: "status",
    });
    el.appendChild(
      h("div", { class: "acewd-head" }, [
        h("h2", { class: "acewd-title", text: c.title }),
        this.chip,
      ]),
    );

    if (c.tiles) el.appendChild(this.buildTiles());
    if (c.controls) el.appendChild(this.buildControls());

    // Chart
    this.chartEl = h("div", { class: "acewd-chart" });
    this.msg = h("div", { class: "acewd-msg", role: "status" });
    // Reserve the chart's height so loading/error messages are visible even when no chart has been drawn yet.
    el.appendChild(
      h(
        "div",
        {
          class: "acewd-chartwrap",
          style: "min-height:" + (c.height + 12) + "px",
        },
        [this.chartEl, this.msg],
      ),
    );

    // Bottom bar
    this.note = h("span", { class: "acewd-note", "aria-live": "polite" });
    this.liveBtn = h("button", {
      type: "button",
      class: "acewd-btn",
      text: "Pause",
    });
    const dl = h("button", {
      type: "button",
      class: "acewd-btn",
      text: "Download CSV",
    });
    this.liveBtn.addEventListener("click", () => {
      st.live = !st.live;
      this.liveBtn.textContent = st.live ? "Pause" : "Resume live";
      if (st.live) this.reload();
      else window.clearTimeout(this.timer);
    });
    dl.addEventListener("click", () => this.csv());
    el.appendChild(
      h("div", { class: "acewd-bottom" }, [
        this.note,
        h("div", { class: "acewd-actions" }, [this.liveBtn, dl]),
      ]),
    );

    // Footer (licence / citation requirements of the data set)
    el.appendChild(
      h("div", {
        class: "acewd-foot",
        html:
          'Data from <a href="https://ambitioncommunityenergy.org/" target="_blank" rel="noopener">Ambition Community Energy (ACE)</a>, ' +
          'licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. ' +
          "Cite: Plumley, Garrad, Burke, Jonsson &amp; Smirthwaite, <em>ACE Wind Turbine Data</em>, Zenodo, " +
          '<a href="' +
          DOI +
          '" target="_blank" rel="noopener">doi:10.5281/zenodo.22662372</a>.',
      }),
    );

    // Resize + visibility handling
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        if (this.plot)
          this.plot.setSize({
            width: this.chartEl.clientWidth,
            height: this.cfg.height,
          });
      }).observe(this.chartEl);
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.tick();
        if (st.live) this.reload();
      }
    });

    this.syncControls();
    this.tick();
    this.reload();
  }

  private buildTiles(): HTMLElement {
    const bar = h("i");
    const make = (
      title: string,
      withBar: boolean,
    ): { root: HTMLElement; tile: Tile } => {
      const v = h("div", { class: "acewd-val", text: "–" });
      const s = h("div", { class: "acewd-sub" });
      const kids = [
        h("h3", { text: title }),
        v,
        s,
        withBar && h("div", { class: "acewd-bar" }, [bar]),
      ];
      return { root: h("div", { class: "acewd-tile" }, kids), tile: { v, s } };
    };
    const power = make("Power output", true);
    const wind = make("Wind speed", false);
    const dir = make("Wind direction", false);
    const rotor = make("Rotor speed", false);
    this.tiles = {
      power: power.tile,
      wind: wind.tile,
      dir: dir.tile,
      rotor: rotor.tile,
      bar,
    };
    return h("div", { class: "acewd-tiles" }, [
      power.root,
      wind.root,
      dir.root,
      rotor.root,
    ]);
  }

  private buildControls(): HTMLElement {
    const st = this.st;
    const box = h("div", { class: "acewd-controls" });

    const select = (
      label: string,
    ): { sel: HTMLSelectElement; wrap: HTMLElement } => {
      const id = uid("sel");
      const sel = h("select", { id });
      const wrap = h("div", { class: "acewd-ctl" }, [
        h("label", { for: id, text: label }),
        sel,
      ]);
      box.appendChild(wrap);
      return { sel, wrap };
    };
    const family = select("Data");
    const asset = select("Turbine / unit");
    const f1 = select("Measurement");
    const f2 = select("Compare with");
    const range = select("Time period");
    const style = select("Chart style");

    // Custom range inputs
    const cs = h("input", { type: "datetime-local", id: uid("from") });
    const ce = h("input", { type: "datetime-local", id: uid("to") });
    const go = h("button", {
      type: "button",
      class: "acewd-btn primary",
      text: "Show",
    });
    const custom = h("div", { class: "acewd-custom" }, [
      h("div", { class: "acewd-ctl" }, [
        h("label", { for: cs.id, text: "From" }),
        cs,
      ]),
      h("div", { class: "acewd-ctl" }, [
        h("label", { for: ce.id, text: "To" }),
        ce,
      ]),
      h("div", { class: "acewd-ctl" }, [go]),
    ]);
    box.appendChild(custom);

    const ctl: Controls = {
      family: family.sel,
      asset: asset.sel,
      assetWrap: asset.wrap,
      f1: f1.sel,
      f2: f2.sel,
      range: range.sel,
      style: style.sel,
      cs,
      ce,
      custom,
    };
    this.ctl = ctl;

    // Any user choice ends automatic widening of the default view.
    [ctl.family, ctl.asset, ctl.f1, ctl.f2, ctl.range, ctl.style].forEach((c) =>
      c.addEventListener("change", () => {
        this.autoWiden = false;
      }),
    );
    go.addEventListener("click", () => {
      this.autoWiden = false;
    });

    STYLES.forEach((s) =>
      ctl.style.appendChild(h("option", { value: s[0], text: s[1] })),
    );
    this.cat.families.forEach((f) =>
      ctl.family.appendChild(h("option", { value: f.family, text: f.label })),
    );

    ctl.family.addEventListener("change", () =>
      this.onFamily(ctl.family.value),
    );
    ctl.asset.addEventListener("change", () => {
      st.asset = ctl.asset.value;
      this.reload();
    });
    ctl.f1.addEventListener("change", () => {
      st.f1 = ctl.f1.value;
      this.fillF2();
      this.reload();
    });
    ctl.f2.addEventListener("change", () => {
      st.f2 = ctl.f2.value;
      this.reload();
    });
    ctl.style.addEventListener("change", () => {
      st.style = ctl.style.value as ChartStyle;
      this.reload();
    });
    ctl.range.addEventListener("change", () => {
      if (ctl.range.value === "custom") {
        ctl.custom.classList.add("show");
        if (!cs.value) {
          const now = new Date();
          cs.value = localInputValue(new Date(now.getTime() - 86400000));
          ce.value = localInputValue(now);
        }
        return;
      }
      ctl.custom.classList.remove("show");
      st.range = parseInt(ctl.range.value, 10);
      st.cStart = st.cEnd = null;
      this.reload();
    });
    go.addEventListener("click", () => {
      const a = new Date(cs.value).getTime();
      const b = new Date(ce.value).getTime();
      if (isNaN(a) || isNaN(b) || b <= a) {
        this.say("Please choose a valid start and end time.");
        return;
      }
      st.range = "custom";
      st.cStart = Math.floor(a / 1000);
      st.cEnd = Math.floor(b / 1000);
      this.reload();
    });
    return box;
  }

  /* ---------- menu population ---------- */

  private fillFields(): void {
    if (!this.ctl) return;
    const s = this.ctl.f1;
    s.innerHTML = "";
    this.fam().fields.forEach((x) =>
      s.appendChild(h("option", { value: x.name, text: fieldLabel(x) })),
    );
  }

  private fillF2(): void {
    if (!this.ctl) return;
    const st = this.st;
    const s = this.ctl.f2;
    s.innerHTML = "";
    s.appendChild(h("option", { value: "", text: "None" }));
    this.fam().fields.forEach((x) => {
      if (x.name !== st.f1)
        s.appendChild(h("option", { value: x.name, text: fieldLabel(x) }));
    });
    if (st.f2 === st.f1) st.f2 = "";
    s.value = st.f2;
  }

  private fillAssets(): void {
    if (!this.ctl) return;
    const f = this.fam();
    const s = this.ctl.asset;
    s.innerHTML = "";
    f.assets.forEach((id) => {
      const known = this.cat.assets.filter((a) => a.id === id).pop();
      s.appendChild(h("option", { value: id, text: known ? known.name : id }));
    });
    this.ctl.assetWrap.style.display = f.assets.length > 1 ? "" : "none";
  }

  private fillRanges(): void {
    if (!this.ctl) return;
    const f = this.fam();
    const st = this.st;
    const s = this.ctl.range;
    let firstOk: number | null = null;
    s.innerHTML = "";
    RANGES.forEach((r) => {
      const ok = !!pickRes(f.resolutions, r[0]);
      const o = h("option", { value: r[0], text: r[1] + (ok ? "" : " (n/a)") });
      if (!ok) o.disabled = true;
      else if (firstOk === null) firstOk = r[0];
      s.appendChild(o);
    });
    s.appendChild(h("option", { value: "custom", text: "Custom range…" }));

    const current = st.range;
    if (current !== "custom" && !pickRes(f.resolutions, current)) {
      // Move to the nearest available preset (by ratio).
      let best: number | null = null;
      let d = Infinity;
      RANGES.forEach((r) => {
        const dist = Math.abs(Math.log(r[0] / current));
        if (pickRes(f.resolutions, r[0]) && dist < d) {
          d = dist;
          best = r[0];
        }
      });
      st.range = best || firstOk || RANGES[0][0];
    }
  }

  private syncControls(): void {
    const ctl = this.ctl;
    if (!ctl) return;
    const st = this.st;
    this.fillAssets();
    this.fillFields();
    this.fillRanges();
    ctl.family.value = st.family;
    if (st.asset) ctl.asset.value = st.asset;
    ctl.f1.value = st.f1;
    this.fillF2();
    ctl.range.value = String(st.range);
    ctl.style.value = st.style;
  }

  private onFamily(name: string): void {
    const st = this.st;
    st.family = name;
    const f = this.fam();
    const names = f.fields.map((x) => x.name);
    st.asset = f.assets[0] || null;
    // Keep the same measurement name if it exists (e.g. "aggregate_active_power"), else take the first.
    st.f1 = names.indexOf(st.f1) >= 0 ? st.f1 : names[0];
    if (names.indexOf(st.f2) < 0) st.f2 = "";
    this.syncControls();
    this.reload();
  }

  /* ---------- status chip + tiles ---------- */

  private setChip(cls: string, text: string): void {
    this.chip.className = "acewd-chip " + cls;
    this.chip.textContent = text;
  }

  /** Fetch the newest readings for the tiles/status chip, then schedule the next round. */
  private tick(): void {
    const c = this.cfg;
    window.clearTimeout(this.tileTimer);
    if (document.hidden) return;

    const site = this.famByName("site_instantaneous");
    const wec = this.famByName("wec_instantaneous");

    const siteReq: Promise<DataResponse | null> = site
      ? request<DataResponse>(c.rest, "data", {
          family: "site_instantaneous",
          resolution: "1s",
          limit: 5,
          _b: nowSeconds(),
          fields:
            "aggregate_active_power,aggregate_wind_speed,aggregate_wind_direction",
        })
      : Promise.resolve(null);
    // A failing turbine request must not blank the site tiles.
    const wecReq: Promise<DataResponse | null> = wec
      ? request<DataResponse>(c.rest, "data", {
          family: "wec_instantaneous",
          resolution: "1s",
          limit: 5,
          _b: nowSeconds(),
          asset: wec.assets[0],
          fields: "wec_rotor_speed",
        }).catch(() => null)
      : Promise.resolve(null);

    Promise.all([siteReq, wecReq])
      .then(([s, w]) => {
        this.tileFail = 0;
        this.showTiles(s, w);
      })
      .catch((e: unknown) => {
        this.tileFail += 1;
        const info = errorInfo(e);
        if (info.retry) this.tileDelay = info.retry * 1000;
        console.warn("[ACE dashboard] live readings failed:", describe(info));
        this.setChip("warn", "Data unavailable");
      })
      .then(() => {
        const base = Math.max(1, c.liveRefresh) * 1000;
        const delay =
          this.tileDelay ||
          Math.min(60000, base * Math.pow(2, Math.min(this.tileFail, 5)));
        this.tileDelay = 0;
        this.tileTimer = window.setTimeout(() => this.tick(), delay);
      });
  }

  private showTiles(s: DataResponse | null, w: DataResponse | null): void {
    const c = this.cfg;
    const p = lastVal(s, "aggregate_active_power");
    const ws = lastVal(s, "aggregate_wind_speed");
    const wd = lastVal(s, "aggregate_wind_direction");
    const rr = lastVal(w, "wec_rotor_speed");

    let newest = 0;
    [p, ws, wd, rr].forEach((x) => {
      if (x && x.t > newest) newest = x.t;
    });

    if (!newest) {
      this.setChip("warn", "No recent data");
    } else {
      const age = Date.now() / 1000 - newest;
      if (age > STALE_AFTER_S)
        this.setChip(
          "warn",
          "Data delayed – last reading " + clock(newest, c.tz, false),
        );
      else if (p && p.v > GENERATING_KW)
        this.setChip("on", "Generating · updated " + clock(newest, c.tz, true));
      else
        this.setChip(
          "",
          "Not generating · updated " + clock(newest, c.tz, true),
        );
    }

    const t = this.tiles;
    if (!t) return;
    if (p) {
      t.power.v.innerHTML = nf(p.v, 0) + "<small>kW</small>";
      const pct = Math.max(0, Math.min(100, (p.v / c.ratedKw) * 100));
      t.power.s.textContent =
        nf(pct, 0) + "% of " + nf(c.ratedKw / 1000, 1) + " MW rated output";
      t.bar.style.width = pct + "%";
    }
    if (ws) {
      t.wind.v.innerHTML = nf(ws.v, 1) + "<small>m/s</small>";
      t.wind.s.textContent = nf(ws.v * MPS_TO_MPH, 1) + " mph";
    }
    if (wd) {
      const deg = ((wd.v % 360) + 360) % 360;
      const point = COMPASS[Math.round(deg / 22.5) % 16];
      // The reading is where the wind comes FROM; the arrow points the way it is blowing TO.
      t.dir.v.innerHTML =
        '<span class="acewd-arrow" style="transform:rotate(' +
        (deg + 180) +
        'deg)">' +
        ARROW +
        "</span>" +
        point +
        "<small>" +
        nf(deg, 0) +
        "°</small>";
      t.dir.s.textContent = "Wind blowing from the " + point;
    }
    if (rr) {
      t.rotor.v.innerHTML = nf(rr.v, 1) + "<small>rpm</small>";
      t.rotor.s.textContent = rr.v > 0.5 ? "Rotor turning" : "Rotor stationary";
    }
  }

  /* ---------- chart ---------- */

  private say(text: string): void {
    this.msg.textContent = text || ""; // also removes any structured error content
    this.msg.classList.remove("is-error");
    this.msg.setAttribute("role", "status");
    this.msg.classList.toggle("show", !!text);
  }

  /** Replace the chart with an explanation of why it can't be shown, and what to try instead. */
  private showFailure(ex: Explained): void {
    if (this.plot) {
      this.plot.destroy();
      this.plot = null;
      this.sig = "";
    }
    this.chartEl.innerHTML = "";
    this.last = null;
    this.note.textContent = "";

    const m = this.msg;
    m.textContent = "";
    m.appendChild(h("div", { class: "acewd-msg__title", text: ex.title }));
    m.appendChild(h("p", { class: "acewd-msg__reason", text: ex.reason }));
    m.appendChild(h("p", { class: "acewd-msg__hint", text: ex.hint }));
    if (ex.tech)
      m.appendChild(h("small", { class: "acewd-msg__tech", text: ex.tech }));
    m.classList.add("is-error", "show");
    m.setAttribute("role", "alert");
  }

  private reload(): void {
    window.clearTimeout(this.timer);
    this.fail = 0;
    this.noRetry = false;
    this.load(true);
  }

  private load(showSpin: boolean): void {
    const st = this.st;
    const f = this.fam();
    const cfg = this.cfg;
    if (this.busy) {
      this.pending = true;
      return;
    }

    const span =
      st.range === "custom" ? (st.cEnd || 0) - (st.cStart || 0) : st.range;
    const res = pickRes(f.resolutions, span);
    if (!res) {
      this.say(
        "That time period isn’t available for this data. Please choose another.",
      );
      return;
    }

    const fields = st.f2 ? [st.f1, st.f2] : [st.f1];
    const params: Params = {
      family: st.family,
      resolution: res.resolution,
      fields: fields.join(","),
      asset: f.scope === "asset" ? st.asset : "",
    };
    if (st.range === "custom") {
      params.start = isoSeconds(st.cStart || 0);
      params.end = isoSeconds(st.cEnd || 0);
    } else {
      params.span = span;
      // A moving window must never be served from a cache: make the URL unique each second.
      params._b = nowSeconds();
    }

    this.busy = true;
    if (showSpin && !this.plot) this.say("Loading chart…");

    request<DataResponse>(cfg.rest, "data", params)
      .then((d) => {
        this.busy = false;
        this.fail = 0;
        // Ignore late replies if the selection changed meanwhile (a reload is already queued).
        if (
          this.pending ||
          st.family !== params.family ||
          st.f1 !== fields[0] ||
          (st.f2 || "") !== (fields[1] || "")
        )
          return;
        this.render(d, fields);
      })
      .catch((e: unknown) => {
        this.busy = false;
        const info = errorInfo(e);
        const detail = describe(info);
        console.warn("[ACE dashboard] chart request failed:", detail, params);
        if (this.pending) return; // the visitor already chose something else; that request is queued

        const ex = explainError(info);
        if (!ex.retryable) {
          // Retrying the identical request would fail identically: explain it instead, in the chart's place.
          this.noRetry = true;
          this.showFailure(ex);
          return;
        }
        this.fail += 1;
        this.say(
          (info.status === 429
            ? "The data service is busy – retrying…"
            : "Couldn’t load data – retrying…") +
            (detail ? " (" + detail + ")" : ""),
        );
        if (info.retry) this.retryAfter = info.retry * 1000;
      })
      .then(() => {
        if (this.pending) {
          this.pending = false;
          this.load(true);
        } else {
          this.schedule(res);
        }
      });
  }

  /**
   * The default view came back empty: step up to the next longer preset that this data set supports and
   * reload straight away, so a first-time visitor sees a chart whenever any data exists.
   */
  private widen(): boolean {
    const st = this.st;
    const cur = st.range;
    if (cur === "custom") return false;
    const f = this.fam();
    const next = RANGES.find((r) => r[0] > cur && pickRes(f.resolutions, r[0]));
    if (!next) {
      this.autoWiden = false;
      return false;
    }
    st.range = next[0];
    if (this.ctl) this.ctl.range.value = String(next[0]);
    this.pending = true; // load() starts the next request as soon as this one finishes
    return true;
  }

  private schedule(res: Resolution): void {
    const st = this.st;
    window.clearTimeout(this.timer);
    if (!st.live || st.range === "custom" || this.noRetry) return;

    const base =
      res.seconds <= 1
        ? Math.max(1, this.cfg.liveRefresh)
        : Math.max(res.refresh, 5);
    let delay = this.fail
      ? Math.min(60000, base * 1000 * Math.pow(2, Math.min(this.fail, 5)))
      : base * 1000;
    if (this.retryAfter) {
      delay = Math.max(delay, this.retryAfter);
      this.retryAfter = 0;
    }

    this.timer = window.setTimeout(() => {
      if (document.hidden) this.schedule(res);
      else this.load(false);
    }, delay);
  }

  private render(d: DataResponse, fields: string[]): void {
    const st = this.st;
    let ts = d.timestamps.slice();
    let cols = fields.map((k) => (d.series[k] || []).slice());

    // Ensure ascending time order, keeping every series aligned.
    let sorted = true;
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] < ts[i - 1]) {
        sorted = false;
        break;
      }
    }
    if (!sorted) {
      const order = ts.map((_, k) => k).sort((a, b) => ts[a] - ts[b]);
      const oldTs = ts;
      ts = order.map((k) => oldTs[k]);
      cols = cols.map((c) => order.map((k) => c[k]));
    }

    if (!ts.length || cols.every((c) => c.every((v) => v == null))) {
      if (this.autoWiden && this.widen()) return;
      this.say("No data available for this period.");
      if (this.plot) {
        this.plot.destroy();
        this.plot = null;
        this.sig = "";
      }
      this.last = null;
      this.note.textContent = "";
      return;
    }
    this.autoWiden = false; // something is on screen now
    this.say("");
    this.last = { ts, cols, fields, meta: d.fields, family: d.family };

    const m1 = d.fields[fields[0]];
    const m2: FieldInfo | null = fields[1] ? d.fields[fields[1]] : null;
    const sepAxis = !!m2 && (m2.unit || "") !== (m1.unit || "");
    const sig = [st.family, st.asset, fields.join(","), st.style, sepAxis].join(
      "|",
    );
    const data = [ts, ...cols] as uPlot.AlignedData;

    if (this.plot && sig === this.sig) {
      this.plot.setData(data, true);
    } else {
      if (this.plot) this.plot.destroy();
      this.chartEl.innerHTML = "";
      this.sig = sig;
      this.plot = new window.uPlot(
        this.plotOptions(m1, m2, sepAxis),
        data,
        this.chartEl,
      );
    }

    this.note.textContent =
      "Showing " +
      (RES_NAMES[d.resolution] || d.resolution) +
      " data · " +
      nf(ts.length, 0) +
      " points" +
      (d.truncated ? " (shortened)" : "") +
      (st.live && st.range !== "custom" ? " · live" : "") +
      " · drag to zoom, double-click to reset";
  }

  private plotOptions(
    m1: FieldInfo,
    m2: FieldInfo | null,
    sepAxis: boolean,
  ): uPlot.Options {
    const cfg = this.cfg;
    const style = this.st.style;
    const tz = cfg.tz;
    const U = window.uPlot;

    const line = (m: FieldInfo, color: string, scale: string): uPlot.Series => {
      const s: uPlot.Series = {
        label: fieldLabel(m),
        stroke: color,
        width: 2,
        scale,
        spanGaps: false,
        points: { show: false },
        value: (_u: uPlot, v: number | null) => (v == null ? "–" : nf(v, 2)),
      };
      if (style === "area") s.fill = color + "30";
      if (style === "step" && U.paths && U.paths.stepped)
        s.paths = U.paths.stepped({ align: 1 });
      return s;
    };

    const timeFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const series: uPlot.Series[] = [
      {
        label: "Time",
        value: (_u: uPlot, v: number | null) =>
          v == null ? "" : timeFmt.format(new Date(v * 1000)),
      },
      line(m1, COLORS[0], "y"),
    ];
    const axes: uPlot.Axis[] = [
      {
        stroke: "#44524d",
        grid: { stroke: "#e6eee9", width: 1 },
        ticks: { stroke: "#cfd9d4" },
      },
      {
        scale: "y",
        stroke: COLORS[0],
        label: m1.unit || m1.label,
        labelSize: 18,
        size: 62,
        grid: { stroke: "#e6eee9", width: 1 },
        ticks: { stroke: "#cfd9d4" },
      },
    ];
    const scales: uPlot.Scales = { x: { time: true }, y: { auto: true } };

    if (m2) {
      series.push(line(m2, COLORS[1], sepAxis ? "y2" : "y"));
      if (sepAxis) {
        scales.y2 = { auto: true };
        axes.push({
          scale: "y2",
          side: 1,
          stroke: COLORS[1],
          label: m2.unit || m2.label,
          labelSize: 18,
          size: 62,
          grid: { show: false },
          ticks: { stroke: "#cfd9d4" },
        });
      }
    }

    return {
      width: Math.max(280, this.chartEl.clientWidth),
      height: cfg.height,
      tzDate: (t: number) => U.tzDate(new Date(t * 1000), tz),
      series,
      axes,
      scales,
      cursor: { drag: { x: true, y: false } },
      legend: { show: true },
    };
  }

  /* ---------- CSV export ---------- */

  private csv(): void {
    const L = this.last;
    if (!L) return;
    const q = (s: string): string => '"' + String(s).replace(/"/g, '""') + '"';
    const rows: string[] = [
      "# Source: Ambition Community Energy (ACE) - ACE Wind Turbine Data, CC BY 4.0, " +
        DOI,
    ];
    rows.push(
      ["Time (UTC)"]
        .concat(L.fields.map((k) => q(fieldLabel(L.meta[k]))))
        .join(","),
    );
    L.ts.forEach((t, i) => {
      rows.push(
        [new Date(t * 1000).toISOString()]
          .concat(L.cols.map((c) => (c[i] == null ? "" : String(c[i]))))
          .join(","),
      );
    });
    const url = URL.createObjectURL(
      new Blob([rows.join("\n")], { type: "text/csv" }),
    );
    const a = h("a", {
      href: url,
      download: "ace-wind-" + L.family + "-" + L.fields[0] + ".csv",
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Turn every `.acewd[data-config]` container on the page into a dashboard. */
export function initAll(): void {
  document
    .querySelectorAll<HTMLElement>(".acewd[data-config]")
    .forEach((el) => {
      new Dash(el);
    });
}

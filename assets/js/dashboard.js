/*! ACE Wind Turbine Dashboard - dashboard - generated from src/ (TypeScript). Do not edit: run "npm run build". */
"use strict";
(() => {
  // src/api.ts
  var ApiError = class extends Error {
    constructor(message, status, retry) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.retry = retry;
    }
  };
  function errorInfo(e) {
    const o = e && typeof e === "object" ? e : {};
    return {
      message: typeof o.message === "string" ? o.message : "",
      status: typeof o.status === "number" ? o.status : void 0,
      retry: typeof o.retry === "number" ? o.retry : 0
    };
  }
  function request(rest, path, params = {}) {
    const qs = Object.keys(params).filter(
      (k) => params[k] !== void 0 && params[k] !== null && params[k] !== ""
    ).map(
      (k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k]))
    ).join("&");
    const url = rest + path + (qs ? (rest.indexOf("?") >= 0 ? "&" : "?") + qs : "");
    return fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store"
    }).then(
      (r) => r.json().catch(() => ({})).then((j) => {
        if (!r.ok) {
          throw new ApiError(
            j.error || "Request failed (" + r.status + ")",
            r.status,
            parseInt(r.headers.get("Retry-After") || "", 10) || 0
          );
        }
        return j;
      })
    );
  }
  var catalogues = {};
  function catalogue(rest) {
    if (!catalogues[rest]) {
      catalogues[rest] = request(rest, "catalogue").catch(
        (e) => {
          delete catalogues[rest];
          throw e;
        }
      );
    }
    return catalogues[rest];
  }

  // src/constants.ts
  var RANGES = [
    [300, "Last 5 minutes"],
    [1800, "Last 30 minutes"],
    [3600, "Last hour"],
    [21600, "Last 6 hours"],
    [86400, "Last 24 hours"],
    [604800, "Last 7 days"],
    [2592e3, "Last 30 days"],
    [7776e3, "Last 90 days"],
    [31536e3, "Last year"]
  ];
  var STYLES = [
    ["line", "Line"],
    ["area", "Area"],
    ["step", "Steps"]
  ];
  var RES_NAMES = {
    "1s": "1-second",
    "60s": "1-minute",
    "10m": "10-minute",
    daily: "daily"
  };
  var COLORS = ["#1f8a4c", "#e07b00"];
  var COMPASS = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW"
  ];
  var DOI = "https://doi.org/10.5281/zenodo.22662372";
  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l6 18-6-4-6 4z"/></svg>';
  var LIMITS = {
    /** Fits the API's single "latest" call. */
    latest: 2e3,
    /** Below this many points the coarse choice looks too sparse... */
    sparse: 60,
    /** ...so step down to a finer resolution as long as it stays within this many. */
    stepDown: 5e3,
    /** Absolute ceiling; matches the server's MAX_POINTS. */
    hard: 12e3,
    /** A chart needs at least this many points. */
    min: 2
  };
  var STALE_AFTER_S = 180;
  var GENERATING_KW = 5;
  var MPS_TO_MPH = 2.23694;

  // src/util.ts
  function hIn(doc, tag, attrs = {}, kids = []) {
    const e = doc.createElement(tag);
    Object.keys(attrs).forEach((k) => {
      const v = String(attrs[k]);
      if (k === "text") e.textContent = v;
      else if (k === "html") e.innerHTML = v;
      else e.setAttribute(k, v);
    });
    kids.forEach((c) => {
      if (c) e.appendChild(c);
    });
    return e;
  }
  function h(tag, attrs = {}, kids = []) {
    return hIn(document, tag, attrs, kids);
  }
  var uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return "acewd-" + prefix + "-" + uidCounter;
  }
  function nowSeconds() {
    return Math.floor(Date.now() / 1e3);
  }
  function nf(v, dp) {
    return v == null || isNaN(v) ? "–" : Number(v).toLocaleString("en-GB", {
      maximumFractionDigits: dp,
      minimumFractionDigits: 0
    });
  }
  function clock(ts, tz, withSec) {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        second: withSec ? "2-digit" : void 0
      }).format(new Date(ts * 1e3));
    } catch (e) {
      return new Date(ts * 1e3).toLocaleTimeString();
    }
  }
  function fieldLabel(f) {
    return f.label + (f.unit ? " (" + f.unit + ")" : "");
  }
  function pickRes(list, span) {
    let chosen = null;
    let idx = -1;
    for (let i = 0; i < list.length; i++) {
      if (span / list[i].seconds <= LIMITS.latest) {
        chosen = list[i];
        idx = i;
        break;
      }
    }
    if (chosen) {
      if (span / chosen.seconds < LIMITS.sparse) {
        for (let j = idx - 1; j >= 0; j--) {
          if (span / list[j].seconds <= LIMITS.stepDown) chosen = list[j];
          else break;
        }
      }
      return span / chosen.seconds >= LIMITS.min ? chosen : null;
    }
    const last = list[list.length - 1];
    return last && span / last.seconds <= LIMITS.hard ? last : null;
  }
  function lastVal(d, field) {
    if (!d || !d.series || !d.series[field]) return null;
    const col = d.series[field];
    for (let i = col.length - 1; i >= 0; i--) {
      const v = col[i];
      if (v != null) return { v, t: d.timestamps[i] };
    }
    return null;
  }

  // src/dashboard.ts
  var describe = (info) => info.status ? "HTTP " + info.status + (info.message ? ": " + info.message : "") : info.message;
  var isoSeconds = (unixSeconds) => new Date(unixSeconds * 1e3).toISOString().replace(/\.\d+Z$/, "Z");
  var localInputValue = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  var Dash = class {
    constructor(el) {
      this.tiles = null;
      this.ctl = null;
      // Chart state.
      this.plot = null;
      this.sig = "";
      this.last = null;
      this.busy = false;
      this.pending = false;
      this.fail = 0;
      this.retryAfter = 0;
      /** Until the user touches a control or a chart has been drawn, an empty default view widens itself. */
      this.autoWiden = true;
      this.tileFail = 0;
      this.tileDelay = 0;
      this.el = el;
      this.cfg = JSON.parse(el.getAttribute("data-config") || "{}");
      this.st = {
        family: "",
        asset: null,
        f1: "",
        f2: "",
        range: this.cfg.range,
        style: "line",
        live: true,
        cStart: null,
        cEnd: null
      };
      catalogue(this.cfg.rest).then(
        (cat) => {
          this.cat = cat;
          this.build();
        },
        (e) => {
          el.innerHTML = "";
          el.appendChild(
            h("p", {
              class: "acewd-error",
              text: "The turbine dashboard is temporarily unavailable. " + errorInfo(e).message
            })
          );
        }
      );
    }
    /* ---------- lookups ---------- */
    fam() {
      const f = this.famByName(this.st.family);
      if (!f) throw new Error("Unknown data set: " + this.st.family);
      return f;
    }
    famByName(name) {
      return this.cat.families.find((f) => f.family === name) || null;
    }
    /* ---------- building the UI ---------- */
    build() {
      const c = this.cfg;
      const el = this.el;
      const st = this.st;
      el.innerHTML = "";
      const f0 = this.famByName(c.family) || this.cat.families[0];
      const names = f0.fields.map((f) => f.name);
      st.family = f0.family;
      st.asset = f0.assets[0] || null;
      st.f1 = names.indexOf(c.field) >= 0 ? c.field : names[0];
      st.f2 = c.compare && c.compare !== st.f1 && names.indexOf(c.compare) >= 0 ? c.compare : "";
      this.chip = h("span", {
        class: "acewd-chip",
        text: "Connecting…",
        role: "status"
      });
      el.appendChild(
        h("div", { class: "acewd-head" }, [
          h("h2", { class: "acewd-title", text: c.title }),
          this.chip
        ])
      );
      if (c.tiles) el.appendChild(this.buildTiles());
      if (c.controls) el.appendChild(this.buildControls());
      this.chartEl = h("div", { class: "acewd-chart" });
      this.msg = h("div", { class: "acewd-msg", role: "status" });
      el.appendChild(
        h("div", { class: "acewd-chartwrap" }, [this.chartEl, this.msg])
      );
      this.note = h("span", { class: "acewd-note", "aria-live": "polite" });
      this.liveBtn = h("button", {
        type: "button",
        class: "acewd-btn",
        text: "Pause"
      });
      const dl = h("button", {
        type: "button",
        class: "acewd-btn",
        text: "Download CSV"
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
          h("div", { class: "acewd-actions" }, [this.liveBtn, dl])
        ])
      );
      el.appendChild(
        h("div", {
          class: "acewd-foot",
          html: 'Data from <a href="https://ambitioncommunityenergy.org/" target="_blank" rel="noopener">Ambition Community Energy (ACE)</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Cite: Plumley, Garrad, Burke, Jonsson &amp; Smirthwaite, <em>ACE Wind Turbine Data</em>, Zenodo, <a href="' + DOI + '" target="_blank" rel="noopener">doi:10.5281/zenodo.22662372</a>.'
        })
      );
      if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(() => {
          if (this.plot)
            this.plot.setSize({
              width: this.chartEl.clientWidth,
              height: this.cfg.height
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
    buildTiles() {
      const bar = h("i");
      const make = (title, withBar) => {
        const v = h("div", { class: "acewd-val", text: "–" });
        const s = h("div", { class: "acewd-sub" });
        const kids = [
          h("h3", { text: title }),
          v,
          s,
          withBar && h("div", { class: "acewd-bar" }, [bar])
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
        bar
      };
      return h("div", { class: "acewd-tiles" }, [
        power.root,
        wind.root,
        dir.root,
        rotor.root
      ]);
    }
    buildControls() {
      const st = this.st;
      const box = h("div", { class: "acewd-controls" });
      const select = (label) => {
        const id = uid("sel");
        const sel = h("select", { id });
        const wrap = h("div", { class: "acewd-ctl" }, [
          h("label", { for: id, text: label }),
          sel
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
      const cs = h("input", { type: "datetime-local", id: uid("from") });
      const ce = h("input", { type: "datetime-local", id: uid("to") });
      const go = h("button", {
        type: "button",
        class: "acewd-btn primary",
        text: "Show"
      });
      const custom = h("div", { class: "acewd-custom" }, [
        h("div", { class: "acewd-ctl" }, [
          h("label", { for: cs.id, text: "From" }),
          cs
        ]),
        h("div", { class: "acewd-ctl" }, [
          h("label", { for: ce.id, text: "To" }),
          ce
        ]),
        h("div", { class: "acewd-ctl" }, [go])
      ]);
      box.appendChild(custom);
      const ctl = {
        family: family.sel,
        asset: asset.sel,
        assetWrap: asset.wrap,
        f1: f1.sel,
        f2: f2.sel,
        range: range.sel,
        style: style.sel,
        cs,
        ce,
        custom
      };
      this.ctl = ctl;
      [ctl.family, ctl.asset, ctl.f1, ctl.f2, ctl.range, ctl.style].forEach(
        (c) => c.addEventListener("change", () => {
          this.autoWiden = false;
        })
      );
      go.addEventListener("click", () => {
        this.autoWiden = false;
      });
      STYLES.forEach(
        (s) => ctl.style.appendChild(h("option", { value: s[0], text: s[1] }))
      );
      this.cat.families.forEach(
        (f) => ctl.family.appendChild(h("option", { value: f.family, text: f.label }))
      );
      ctl.family.addEventListener(
        "change",
        () => this.onFamily(ctl.family.value)
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
        st.style = ctl.style.value;
        this.reload();
      });
      ctl.range.addEventListener("change", () => {
        if (ctl.range.value === "custom") {
          ctl.custom.classList.add("show");
          if (!cs.value) {
            const now = /* @__PURE__ */ new Date();
            cs.value = localInputValue(new Date(now.getTime() - 864e5));
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
        st.cStart = Math.floor(a / 1e3);
        st.cEnd = Math.floor(b / 1e3);
        this.reload();
      });
      return box;
    }
    /* ---------- menu population ---------- */
    fillFields() {
      if (!this.ctl) return;
      const s = this.ctl.f1;
      s.innerHTML = "";
      this.fam().fields.forEach(
        (x) => s.appendChild(h("option", { value: x.name, text: fieldLabel(x) }))
      );
    }
    fillF2() {
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
    fillAssets() {
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
    fillRanges() {
      if (!this.ctl) return;
      const f = this.fam();
      const st = this.st;
      const s = this.ctl.range;
      let firstOk = null;
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
        let best = null;
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
    syncControls() {
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
    onFamily(name) {
      const st = this.st;
      st.family = name;
      const f = this.fam();
      const names = f.fields.map((x) => x.name);
      st.asset = f.assets[0] || null;
      st.f1 = names.indexOf(st.f1) >= 0 ? st.f1 : names[0];
      if (names.indexOf(st.f2) < 0) st.f2 = "";
      this.syncControls();
      this.reload();
    }
    /* ---------- status chip + tiles ---------- */
    setChip(cls, text) {
      this.chip.className = "acewd-chip " + cls;
      this.chip.textContent = text;
    }
    /** Fetch the newest readings for the tiles/status chip, then schedule the next round. */
    tick() {
      const c = this.cfg;
      window.clearTimeout(this.tileTimer);
      if (document.hidden) return;
      const site = this.famByName("site_instantaneous");
      const wec = this.famByName("wec_instantaneous");
      const siteReq = site ? request(c.rest, "data", {
        family: "site_instantaneous",
        resolution: "1s",
        limit: 5,
        _b: nowSeconds(),
        fields: "aggregate_active_power,aggregate_wind_speed,aggregate_wind_direction"
      }) : Promise.resolve(null);
      const wecReq = wec ? request(c.rest, "data", {
        family: "wec_instantaneous",
        resolution: "1s",
        limit: 5,
        _b: nowSeconds(),
        asset: wec.assets[0],
        fields: "wec_rotor_speed"
      }).catch(() => null) : Promise.resolve(null);
      Promise.all([siteReq, wecReq]).then(([s, w]) => {
        this.tileFail = 0;
        this.showTiles(s, w);
      }).catch((e) => {
        this.tileFail += 1;
        const info = errorInfo(e);
        if (info.retry) this.tileDelay = info.retry * 1e3;
        console.warn("[ACE dashboard] live readings failed:", describe(info));
        this.setChip("warn", "Data unavailable");
      }).then(() => {
        const base = Math.max(1, c.liveRefresh) * 1e3;
        const delay = this.tileDelay || Math.min(6e4, base * Math.pow(2, Math.min(this.tileFail, 5)));
        this.tileDelay = 0;
        this.tileTimer = window.setTimeout(() => this.tick(), delay);
      });
    }
    showTiles(s, w) {
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
        const age = Date.now() / 1e3 - newest;
        if (age > STALE_AFTER_S)
          this.setChip(
            "warn",
            "Data delayed – last reading " + clock(newest, c.tz, false)
          );
        else if (p && p.v > GENERATING_KW)
          this.setChip("on", "Generating · updated " + clock(newest, c.tz, true));
        else
          this.setChip(
            "",
            "Not generating · updated " + clock(newest, c.tz, true)
          );
      }
      const t = this.tiles;
      if (!t) return;
      if (p) {
        t.power.v.innerHTML = nf(p.v, 0) + "<small>kW</small>";
        const pct = Math.max(0, Math.min(100, p.v / c.ratedKw * 100));
        t.power.s.textContent = nf(pct, 0) + "% of " + nf(c.ratedKw / 1e3, 1) + " MW rated output";
        t.bar.style.width = pct + "%";
      }
      if (ws) {
        t.wind.v.innerHTML = nf(ws.v, 1) + "<small>m/s</small>";
        t.wind.s.textContent = nf(ws.v * MPS_TO_MPH, 1) + " mph";
      }
      if (wd) {
        const deg = (wd.v % 360 + 360) % 360;
        const point = COMPASS[Math.round(deg / 22.5) % 16];
        t.dir.v.innerHTML = '<span class="acewd-arrow" style="transform:rotate(' + (deg + 180) + 'deg)">' + ARROW + "</span>" + point + "<small>" + nf(deg, 0) + "°</small>";
        t.dir.s.textContent = "Wind blowing from the " + point;
      }
      if (rr) {
        t.rotor.v.innerHTML = nf(rr.v, 1) + "<small>rpm</small>";
        t.rotor.s.textContent = rr.v > 0.5 ? "Rotor turning" : "Rotor stationary";
      }
    }
    /* ---------- chart ---------- */
    say(text) {
      this.msg.textContent = text || "";
      this.msg.classList.toggle("show", !!text);
    }
    reload() {
      window.clearTimeout(this.timer);
      this.fail = 0;
      this.load(true);
    }
    load(showSpin) {
      const st = this.st;
      const f = this.fam();
      const cfg = this.cfg;
      if (this.busy) {
        this.pending = true;
        return;
      }
      const span = st.range === "custom" ? (st.cEnd || 0) - (st.cStart || 0) : st.range;
      const res = pickRes(f.resolutions, span);
      if (!res) {
        this.say(
          "That time period isn’t available for this data. Please choose another."
        );
        return;
      }
      const fields = st.f2 ? [st.f1, st.f2] : [st.f1];
      const params = {
        family: st.family,
        resolution: res.resolution,
        fields: fields.join(","),
        asset: f.scope === "asset" ? st.asset : ""
      };
      if (st.range === "custom") {
        params.start = isoSeconds(st.cStart || 0);
        params.end = isoSeconds(st.cEnd || 0);
      } else {
        params.span = span;
        params._b = nowSeconds();
      }
      this.busy = true;
      if (showSpin && !this.plot) this.say("Loading chart…");
      request(cfg.rest, "data", params).then((d) => {
        this.busy = false;
        this.fail = 0;
        if (this.pending || st.family !== params.family || st.f1 !== fields[0] || (st.f2 || "") !== (fields[1] || ""))
          return;
        this.render(d, fields);
      }).catch((e) => {
        this.busy = false;
        this.fail += 1;
        const info = errorInfo(e);
        const detail = describe(info);
        console.warn("[ACE dashboard] chart request failed:", detail, params);
        this.say(
          (info.status === 429 ? "The data service is busy – retrying…" : "Couldn’t load data – retrying…") + (detail ? " (" + detail + ")" : "")
        );
        if (info.retry) this.retryAfter = info.retry * 1e3;
      }).then(() => {
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
    widen() {
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
      this.pending = true;
      return true;
    }
    schedule(res) {
      const st = this.st;
      window.clearTimeout(this.timer);
      if (!st.live || st.range === "custom") return;
      const base = res.seconds <= 1 ? Math.max(1, this.cfg.liveRefresh) : Math.max(res.refresh, 5);
      let delay = this.fail ? Math.min(6e4, base * 1e3 * Math.pow(2, Math.min(this.fail, 5))) : base * 1e3;
      if (this.retryAfter) {
        delay = Math.max(delay, this.retryAfter);
        this.retryAfter = 0;
      }
      this.timer = window.setTimeout(() => {
        if (document.hidden) this.schedule(res);
        else this.load(false);
      }, delay);
    }
    render(d, fields) {
      const st = this.st;
      let ts = d.timestamps.slice();
      let cols = fields.map((k) => (d.series[k] || []).slice());
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
      this.autoWiden = false;
      this.say("");
      this.last = { ts, cols, fields, meta: d.fields, family: d.family };
      const m1 = d.fields[fields[0]];
      const m2 = fields[1] ? d.fields[fields[1]] : null;
      const sepAxis = !!m2 && (m2.unit || "") !== (m1.unit || "");
      const sig = [st.family, st.asset, fields.join(","), st.style, sepAxis].join(
        "|"
      );
      const data = [ts, ...cols];
      if (this.plot && sig === this.sig) {
        this.plot.setData(data, true);
      } else {
        if (this.plot) this.plot.destroy();
        this.chartEl.innerHTML = "";
        this.sig = sig;
        this.plot = new window.uPlot(
          this.plotOptions(m1, m2, sepAxis),
          data,
          this.chartEl
        );
      }
      this.note.textContent = "Showing " + (RES_NAMES[d.resolution] || d.resolution) + " data · " + nf(ts.length, 0) + " points" + (d.truncated ? " (shortened)" : "") + (st.live && st.range !== "custom" ? " · live" : "") + " · drag to zoom, double-click to reset";
    }
    plotOptions(m1, m2, sepAxis) {
      const cfg = this.cfg;
      const style = this.st.style;
      const tz = cfg.tz;
      const U = window.uPlot;
      const line = (m, color, scale) => {
        const s = {
          label: fieldLabel(m),
          stroke: color,
          width: 2,
          scale,
          spanGaps: false,
          points: { show: false },
          value: (_u, v) => v == null ? "–" : nf(v, 2)
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
        second: "2-digit"
      });
      const series = [
        {
          label: "Time",
          value: (_u, v) => v == null ? "" : timeFmt.format(new Date(v * 1e3))
        },
        line(m1, COLORS[0], "y")
      ];
      const axes = [
        {
          stroke: "#44524d",
          grid: { stroke: "#e6eee9", width: 1 },
          ticks: { stroke: "#cfd9d4" }
        },
        {
          scale: "y",
          stroke: COLORS[0],
          label: m1.unit || m1.label,
          labelSize: 18,
          size: 62,
          grid: { stroke: "#e6eee9", width: 1 },
          ticks: { stroke: "#cfd9d4" }
        }
      ];
      const scales = { x: { time: true }, y: { auto: true } };
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
            ticks: { stroke: "#cfd9d4" }
          });
        }
      }
      return {
        width: Math.max(280, this.chartEl.clientWidth),
        height: cfg.height,
        tzDate: (t) => U.tzDate(new Date(t * 1e3), tz),
        series,
        axes,
        scales,
        cursor: { drag: { x: true, y: false } },
        legend: { show: true }
      };
    }
    /* ---------- CSV export ---------- */
    csv() {
      const L = this.last;
      if (!L) return;
      const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
      const rows = [
        "# Source: Ambition Community Energy (ACE) - ACE Wind Turbine Data, CC BY 4.0, " + DOI
      ];
      rows.push(
        ["Time (UTC)"].concat(L.fields.map((k) => q(fieldLabel(L.meta[k])))).join(",")
      );
      L.ts.forEach((t, i) => {
        rows.push(
          [new Date(t * 1e3).toISOString()].concat(L.cols.map((c) => c[i] == null ? "" : String(c[i]))).join(",")
        );
      });
      const url = URL.createObjectURL(
        new Blob([rows.join("\n")], { type: "text/csv" })
      );
      const a = h("a", {
        href: url,
        download: "ace-wind-" + L.family + "-" + L.fields[0] + ".csv"
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1e3);
    }
  };
  function initAll() {
    document.querySelectorAll(".acewd[data-config]").forEach((el) => {
      new Dash(el);
    });
  }

  // src/main.ts
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
})();

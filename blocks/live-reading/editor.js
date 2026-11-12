/*! ACE Wind Turbine Dashboard - live reading block (editor) - generated from src/ (TypeScript). Do not edit: run "npm run build". */
"use strict";
(() => {
  // src/reading/icons.ts
  var open = (name) => '<svg class="acewd-ico acewd-ico--' + name + '" viewBox="0 0 64 64" aria-hidden="true" focusable="false">';
  var BLADE = "M32 22C30 14 31 6 32 3c1 3 2 11 0 19z";
  var ICONS = {
    turbine: open("turbine") + '<path d="M30.5 27h3L35 62H29z" fill="currentColor" opacity=".55"/><g class="acewd-blades" fill="currentColor"><path d="' + BLADE + '"/><path d="' + BLADE + '" transform="rotate(120 32 24)"/><path d="' + BLADE + '" transform="rotate(240 32 24)"/></g><circle cx="32" cy="24" r="3.2" fill="currentColor"/></svg>',
    wind: open("wind") + '<g class="acewd-flow" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"><path d="M6 22h30a7 7 0 1 0-7-7"/><path d="M6 34h44a8 8 0 1 1-8 8"/><path d="M6 46h20"/></g></svg>',
    compass: open("compass") + '<circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="3" opacity=".45"/><path d="M32 4v6M32 54v6M4 32h6M54 32h6" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".6"/><g class="acewd-needle"><path d="M32 11l8 21H24z" fill="currentColor"/><path d="M32 53l-8-21h16z" fill="currentColor" opacity=".3"/></g></svg>',
    bolt: open("bolt") + '<path class="acewd-bolt" d="M37 3L13 36h15l-4 25 27-35H35z" fill="currentColor"/></svg>',
    gauge: open("gauge") + '<path d="M8 46a24 24 0 0 1 48 0" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity=".25"/><path class="acewd-arc" d="M8 46a24 24 0 0 1 48 0" pathLength="100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><g class="acewd-gneedle"><path d="M32 46V26" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><circle cx="32" cy="46" r="4.5" fill="currentColor"/></g></svg>'
  };
  var BUILT_IN = ["turbine", "wind", "compass", "bolt", "gauge"];
  function resolveIcon(icon, spec) {
    return icon === "auto" ? spec.icon : icon;
  }
  function safeImageUrl(url) {
    const u = String(url || "").trim();
    if (/^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u)) return u;
    return "";
  }

  // src/constants.ts
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
  var STALE_AFTER_S = 180;
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
  function lastVal(d, field) {
    if (!d || !d.series || !d.series[field]) return null;
    const col = d.series[field];
    for (let i = col.length - 1; i >= 0; i--) {
      const v = col[i];
      if (v != null) return { v, t: d.timestamps[i] };
    }
    return null;
  }

  // src/reading/metrics.ts
  var FULL_WIND_MS = 25;
  var FULL_ROTOR_RPM = 20;
  var METRICS = {
    power: {
      key: "power",
      label: "Power output",
      family: "site_instantaneous",
      field: "aggregate_active_power",
      icon: "bolt",
      units: [{ unit: "kW", factor: 1, decimals: 0 }, { unit: "MW", factor: 1e-3, decimals: 2 }]
    },
    power_pct: {
      key: "power_pct",
      label: "Share of rated output",
      family: "site_instantaneous",
      field: "aggregate_active_power",
      icon: "gauge",
      units: [{ unit: "%", factor: 1, decimals: 0 }]
    },
    wind_speed: {
      key: "wind_speed",
      label: "Wind speed",
      family: "site_instantaneous",
      field: "aggregate_wind_speed",
      icon: "wind",
      units: [
        { unit: "m/s", factor: 1, decimals: 1 },
        { unit: "mph", factor: MPS_TO_MPH, decimals: 1 },
        { unit: "km/h", factor: 3.6, decimals: 0 },
        { unit: "knots", factor: 1.94384, decimals: 1 }
      ]
    },
    wind_direction: {
      key: "wind_direction",
      label: "Wind direction",
      family: "site_instantaneous",
      field: "aggregate_wind_direction",
      icon: "compass",
      units: [{ unit: "°", factor: 1, decimals: 0 }]
    },
    rotor_speed: {
      key: "rotor_speed",
      label: "Rotor speed",
      family: "wec_instantaneous",
      field: "wec_rotor_speed",
      icon: "turbine",
      units: [{ unit: "rpm", factor: 1, decimals: 1 }]
    }
  };
  var PRESET_KEYS = Object.keys(METRICS);
  var CUSTOM = "custom";
  function customSpec(family, field) {
    return {
      key: CUSTOM,
      label: field.label,
      family,
      field: field.name,
      icon: "gauge",
      units: [{ unit: field.unit, factor: 1, decimals: 1 }]
    };
  }
  var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function computeDisplay(cfg, spec, raw, t, nowS) {
    const opt = spec.units.find((u) => u.unit === cfg.unit) || spec.units[0];
    const dp = cfg.decimals >= 0 ? cfg.decimals : opt.decimals;
    const rated = Math.max(1, cfg.ratedKw);
    const d = {
      label: cfg.label || spec.label,
      value: "–",
      unit: opt.unit,
      detail: "",
      updated: t != null ? clock(t, cfg.tz, true) : "",
      fraction: 0,
      deg: 0,
      spin: null,
      flow: null,
      pulse: 3,
      glow: 2,
      stale: t != null && nowS - t > STALE_AFTER_S,
      empty: raw == null
    };
    if (raw == null) return d;
    let intensity = null;
    switch (spec.key) {
      case "power": {
        d.value = nf(raw * opt.factor, dp);
        d.detail = nf(raw / rated * 100, 0) + "% of " + nf(rated / 1e3, 1) + " MW rated output";
        d.fraction = intensity = clamp(raw / rated, 0, 1);
        break;
      }
      case "power_pct": {
        d.value = nf(raw / rated * 100, dp);
        d.detail = nf(raw, 0) + " kW";
        d.fraction = intensity = clamp(raw / rated, 0, 1);
        break;
      }
      case "wind_speed": {
        d.value = nf(raw * opt.factor, dp);
        d.detail = opt.unit === "m/s" ? nf(raw * MPS_TO_MPH, 1) + " mph" : nf(raw, 1) + " m/s";
        d.fraction = intensity = clamp(raw / FULL_WIND_MS, 0, 1);
        break;
      }
      case "wind_direction": {
        const deg = (raw % 360 + 360) % 360;
        const point = COMPASS[Math.round(deg / 22.5) % 16];
        if (cfg.directionFormat === "degrees") {
          d.value = nf(deg, dp);
          d.unit = "°";
        } else if (cfg.directionFormat === "compass") {
          d.value = point;
          d.unit = "";
        } else {
          d.value = point;
          d.unit = nf(deg, dp) + "°";
        }
        d.detail = "Wind blowing from the " + point;
        d.deg = deg + 180;
        d.fraction = deg / 360;
        break;
      }
      case "rotor_speed": {
        d.value = nf(raw * opt.factor, dp);
        d.detail = raw > 0.5 ? "Rotor turning" : "Rotor stationary";
        d.fraction = intensity = clamp(raw / FULL_ROTOR_RPM, 0, 1);
        break;
      }
      default: {
        d.value = nf(raw * opt.factor, dp);
        d.fraction = 0.5;
      }
    }
    const mf = intensity == null ? 0.5 : intensity;
    if (spec.key === "rotor_speed") {
      d.spin = raw > 0.3 ? clamp(60 / raw, 0.6, 40) : null;
    } else {
      d.spin = mf > 0.02 ? 16 - 14 * mf : null;
    }
    d.flow = mf > 0.02 ? 4 - 3.2 * mf : null;
    d.pulse = 3 - 2.2 * mf;
    d.glow = 2 + 10 * mf;
    return d;
  }

  // src/reading/block-model.ts
  var BLOCK_NAME = "ace-wind/live-reading";
  var DEFAULT_ATTRS = {
    metric: "power",
    family: "",
    field: "",
    unit: "",
    decimals: -1,
    showLabel: true,
    label: "",
    showDetail: true,
    showUpdated: false,
    directionFormat: "both",
    icon: "auto",
    iconUrl: "",
    iconColor: "",
    layout: "left",
    iconSize: 56,
    animate: true
  };
  var METRIC_OPTIONS = [
    ...PRESET_KEYS.map((k) => ({ value: k, label: METRICS[k].label })),
    { value: CUSTOM, label: "Other measurement…" }
  ];
  var ICON_OPTIONS = [
    { value: "auto", label: "Automatic (matches the measurement)" },
    { value: "turbine", label: "Wind turbine (spins at the real rotor speed)" },
    { value: "wind", label: "Wind (lines flow faster in stronger wind)" },
    { value: "compass", label: "Compass (points the way the wind blows)" },
    { value: "bolt", label: "Lightning bolt (glows with power)" },
    { value: "gauge", label: "Gauge (needle follows the value)" },
    { value: "image", label: "My own image or SVG" },
    { value: "none", label: "No icon" }
  ];
  var LAYOUT_OPTIONS = [
    { value: "left", label: "Icon on the left" },
    { value: "right", label: "Icon on the right" },
    { value: "top", label: "Icon above" },
    { value: "background", label: "Icon as a faint background" }
  ];
  var DIRECTION_OPTIONS = [
    { value: "both", label: "Compass point and degrees (NNE 22°)" },
    { value: "compass", label: "Compass point only (NNE)" },
    { value: "degrees", label: "Degrees only (22°)" }
  ];
  var DECIMAL_LABELS = ["Automatic", "0", "1", "2", "3"];
  function unitOptions(attrs) {
    const spec = METRICS[attrs.metric];
    if (!spec || spec.units.length < 2) return [];
    return spec.units.map((u) => ({ value: u.unit, label: u.unit }));
  }
  function familyOptions(cat) {
    if (!cat) return [];
    return cat.families.map((f) => ({ value: f.family, label: f.label }));
  }
  function fieldOptions(cat, family) {
    const fam = cat && cat.families.find((f) => f.family === family);
    return fam ? fam.fields.map((f) => ({ value: f.name, label: f.label + (f.unit ? " (" + f.unit + ")" : "") })) : [];
  }
  function metricChange(metric) {
    return { metric, unit: "", family: "", field: "" };
  }
  function familyChange(cat, family) {
    const first = fieldOptions(cat, family)[0];
    return { family, field: first ? first.value : "" };
  }
  function buildConfig(attrs, env) {
    return { ...DEFAULT_ATTRS, ...attrs, ...env };
  }
  var ENV_FALLBACK = { rest: "/wp-json/ace-wind/v1/", ratedKw: 4200, liveRefresh: 2, tz: "Europe/London" };

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

  // src/reading/readings.ts
  var ReadingHub = class {
    constructor(rest, liveRefresh) {
      this.rest = rest;
      this.liveRefresh = liveRefresh;
      this.groups = {};
      this.listening = false;
    }
    /** Start receiving readings of `field` in `family`. Returns an unsubscribe function. */
    subscribe(family, field, cb) {
      let g = this.groups[family];
      if (!g) {
        g = this.groups[family] = { family, subs: [], timer: void 0, busy: false, fail: 0, retryAfter: 0, last: null };
      }
      const isNewField = !g.subs.some((s) => s.field === field);
      const sub = { field, cb };
      g.subs.push(sub);
      this.watchVisibility();
      if (g.last) {
        const snapshot = g.last;
        window.setTimeout(() => {
          if (g.subs.indexOf(sub) >= 0) cb(snapshot);
        }, 0);
      }
      if (g.subs.length === 1 || isNewField && !g.busy) {
        window.clearTimeout(g.timer);
        g.timer = window.setTimeout(() => this.poll(g), 0);
      }
      return () => {
        g.subs = g.subs.filter((s) => s !== sub);
        if (!g.subs.length) {
          window.clearTimeout(g.timer);
          delete this.groups[family];
        }
      };
    }
    watchVisibility() {
      if (this.listening) return;
      this.listening = true;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        Object.keys(this.groups).forEach((k) => {
          const g = this.groups[k];
          window.clearTimeout(g.timer);
          if (!g.busy) this.poll(g);
        });
      });
    }
    poll(g) {
      window.clearTimeout(g.timer);
      if (!g.subs.length || g.busy) return;
      if (document.hidden) return;
      g.busy = true;
      let intervalS = Math.max(1, this.liveRefresh);
      catalogue(this.rest).then((cat) => {
        const f = cat.families.find((x) => x.family === g.family);
        if (!f) throw Object.assign(new Error("Unknown data set: " + g.family), { status: 404 });
        const res = f.resolutions[0];
        intervalS = res.seconds <= 1 ? Math.max(1, this.liveRefresh) : Math.max(res.refresh, 5);
        const fields = g.subs.map((s) => s.field).filter((v, i, a) => a.indexOf(v) === i);
        return request(this.rest, "data", {
          family: g.family,
          resolution: res.resolution,
          limit: 5,
          _b: nowSeconds(),
          fields: fields.join(","),
          asset: f.scope === "asset" ? f.assets[0] : ""
        });
      }).then((d) => {
        g.fail = 0;
        const values = {};
        let newest = null;
        g.subs.forEach((s) => {
          const v = lastVal(d, s.field);
          values[s.field] = v;
          if (v && (newest === null || v.t > newest)) newest = v.t;
        });
        this.deliver(g, { values, newest, error: null });
      }).catch((e) => {
        g.fail += 1;
        const info = errorInfo(e);
        if (info.retry) g.retryAfter = info.retry * 1e3;
        console.warn("[ACE dashboard] live reading failed:", info.status ? "HTTP " + info.status + ": " + info.message : info.message);
        this.deliver(g, { values: {}, newest: null, error: info.message || "Data unavailable" }, false);
      }).then(() => {
        g.busy = false;
        if (!g.subs.length) return;
        let delay = g.fail ? Math.min(6e4, intervalS * 1e3 * Math.pow(2, Math.min(g.fail, 5))) : intervalS * 1e3;
        if (g.retryAfter) {
          delay = Math.max(delay, g.retryAfter);
          g.retryAfter = 0;
        }
        g.timer = window.setTimeout(() => this.poll(g), delay);
      });
    }
    deliver(g, u, remember = true) {
      if (remember) g.last = u;
      g.subs.slice().forEach((s) => s.cb(u));
    }
  };
  var hubs = {};
  function hubFor(rest, liveRefresh) {
    if (!hubs[rest]) hubs[rest] = new ReadingHub(rest, liveRefresh);
    return hubs[rest];
  }

  // src/reading/reading-view.ts
  function mountReading(host, cfg, opts = {}) {
    const doc = host.ownerDocument || document;
    const hub = opts.hub || hubFor(cfg.rest, cfg.liveRefresh);
    const now = opts.now || nowSeconds;
    let unsubscribe = null;
    let destroyed = false;
    let spec = METRICS[cfg.metric] || null;
    host.innerHTML = "";
    host.setAttribute("data-animate", cfg.animate ? "1" : "0");
    host.style.setProperty("--acewd-icon-size", cfg.iconSize + "px");
    if (cfg.iconColor) host.style.setProperty("--acewd-icon-color", cfg.iconColor);
    const root = hIn(doc, "div", { class: "acewd-r acewd-r--" + cfg.layout });
    host.appendChild(root);
    const iconName = cfg.icon;
    let iconEl = null;
    const placeIcon = (name) => {
      if (iconEl) iconEl.remove();
      iconEl = null;
      if (name === "none") return;
      const box = hIn(doc, "div", { class: "acewd-r__icon" });
      if (name === "image") {
        const url = safeImageUrl(cfg.iconUrl);
        if (!url) return;
        box.appendChild(hIn(doc, "img", { src: url, alt: "", class: "acewd-r__img" }));
      } else if (BUILT_IN.indexOf(name) >= 0) {
        box.innerHTML = ICONS[name];
      } else {
        return;
      }
      iconEl = box;
      root.insertBefore(box, root.firstChild);
    };
    const body = hIn(doc, "div", { class: "acewd-r__body" });
    const labelEl = cfg.showLabel ? hIn(doc, "div", { class: "acewd-r__label" }) : null;
    const valueEl = hIn(doc, "div", { class: "acewd-r__value", "aria-live": "off" });
    const unitEl = hIn(doc, "small", { class: "acewd-r__unit" });
    const valueText = doc.createTextNode("–");
    valueEl.appendChild(valueText);
    valueEl.appendChild(unitEl);
    const detailEl = cfg.showDetail ? hIn(doc, "div", { class: "acewd-r__detail" }) : null;
    const updatedEl = cfg.showUpdated ? hIn(doc, "div", { class: "acewd-r__updated" }) : null;
    [labelEl, valueEl, detailEl, updatedEl].forEach((e) => {
      if (e) body.appendChild(e);
    });
    root.appendChild(body);
    if (labelEl) labelEl.textContent = cfg.label || (spec ? spec.label : "…");
    placeIcon(iconName === "auto" ? spec ? spec.icon : "gauge" : iconName);
    const render = (u) => {
      if (destroyed || !spec) return;
      const hit = u.values[spec.field];
      const d = computeDisplay(cfg, spec, hit ? hit.v : null, hit ? hit.t : null, now());
      root.classList.toggle("is-stale", d.stale);
      root.classList.toggle("is-error", !!u.error);
      if (labelEl) labelEl.textContent = d.label;
      valueText.nodeValue = d.value;
      unitEl.textContent = d.unit;
      unitEl.style.display = d.unit ? "" : "none";
      if (detailEl) {
        detailEl.textContent = u.error ? "Data unavailable" : d.stale ? "Data delayed – last reading " + d.updated : d.detail;
      }
      if (updatedEl) updatedEl.textContent = d.updated ? "Updated " + d.updated : "";
      if (iconEl) {
        const s = iconEl.style;
        s.setProperty("--acewd-spin", (d.spin === null ? 8 : d.spin) + "s");
        s.setProperty("--acewd-spin-play", d.spin === null || d.stale ? "paused" : "running");
        s.setProperty("--acewd-flow", (d.flow === null ? 4 : d.flow) + "s");
        s.setProperty("--acewd-flow-play", d.flow === null || d.stale ? "paused" : "running");
        s.setProperty("--acewd-deg", d.deg + "deg");
        s.setProperty("--acewd-frac", String(d.fraction));
        s.setProperty("--acewd-pulse", d.pulse + "s");
        s.setProperty("--acewd-glow", d.glow + "px");
      }
    };
    const start = () => {
      if (destroyed || !spec) return;
      const resolved = resolveIcon(iconName, spec);
      if (iconName === "auto") placeIcon(resolved);
      if (labelEl) labelEl.textContent = cfg.label || spec.label;
      unsubscribe = hub.subscribe(spec.family, spec.field, render);
    };
    if (spec) {
      start();
    } else if (cfg.metric === CUSTOM && cfg.family && cfg.field) {
      catalogue(cfg.rest).then((cat) => {
        const fam = cat.families.find((f) => f.family === cfg.family);
        const fld = fam && fam.fields.find((f) => f.name === cfg.field);
        if (!fam || !fld) throw new Error("Unknown measurement");
        spec = customSpec(cfg.family, fld);
        start();
      }).catch(() => {
        if (labelEl) labelEl.textContent = "Measurement unavailable";
        root.classList.add("is-error");
      });
    } else {
      if (labelEl) labelEl.textContent = "Choose a measurement";
      root.classList.add("is-error");
    }
    return {
      destroy() {
        destroyed = true;
        if (unsubscribe) unsubscribe();
        host.innerHTML = "";
      }
    };
  }

  // src/reading/editor.ts
  function registerBlock(wp, env = ENV_FALLBACK) {
    const { createElement: h, Fragment, useEffect, useRef, useState } = wp.element;
    const { InspectorControls, useBlockProps, MediaUpload, MediaUploadCheck, PanelColorSettings } = wp.blockEditor;
    const { PanelBody, SelectControl, ToggleControl, TextControl, RangeControl, Button } = wp.components;
    const __ = (s) => wp.i18n.__(s, "ace-wind-dashboard");
    function Edit(props) {
      const attrs = { ...DEFAULT_ATTRS, ...props.attributes };
      const set = props.setAttributes;
      const host = useRef(null);
      const [cat, setCat] = useState(null);
      const signature = JSON.stringify(attrs);
      useEffect(() => {
        if (!host.current) return void 0;
        const mounted = mountReading(host.current, buildConfig(attrs, env));
        return () => mounted.destroy();
      }, [signature]);
      useEffect(() => {
        if (attrs.metric !== CUSTOM || cat) return;
        catalogue(env.rest).then(setCat, () => void 0);
      }, [attrs.metric]);
      const select = (label, value, options, onChange, help) => h(SelectControl, { label: __(label), value, options, onChange, help, __nextHasNoMarginBottom: true });
      const toggle = (label, key) => h(ToggleControl, { label: __(label), checked: !!attrs[key], onChange: (v) => set({ [key]: v }), __nextHasNoMarginBottom: true });
      const units = unitOptions(attrs);
      const measurement = [
        select("Measurement", attrs.metric, METRIC_OPTIONS, (v) => set(metricChange(v))),
        attrs.metric === CUSTOM && h(
          Fragment,
          null,
          select(
            "Data set",
            attrs.family,
            [{ value: "", label: cat ? __("Choose…") : __("Loading…") }, ...familyOptions(cat)],
            (v) => set(familyChange(cat, v))
          ),
          attrs.family && select("Value", attrs.field, fieldOptions(cat, attrs.family), (v) => set({ field: v }))
        ),
        units.length > 0 && select("Unit", attrs.unit || units[0].value, units, (v) => set({ unit: v })),
        attrs.metric === "wind_direction" && select("Show direction as", attrs.directionFormat, DIRECTION_OPTIONS, (v) => set({ directionFormat: v })),
        h(RangeControl, {
          label: __("Decimal places"),
          min: -1,
          max: 3,
          value: attrs.decimals,
          onChange: (v) => set({ decimals: v === void 0 ? -1 : v }),
          renderTooltipContent: (v) => DECIMAL_LABELS[v + 1],
          help: __("-1 chooses a sensible number automatically."),
          __nextHasNoMarginBottom: true
        }),
        toggle("Show label", "showLabel"),
        attrs.showLabel && h(TextControl, { label: __("Label"), value: attrs.label, placeholder: __("Default for this measurement"), onChange: (v) => set({ label: v }), __nextHasNoMarginBottom: true }),
        toggle("Show extra detail line", "showDetail"),
        toggle("Show time of last reading", "showUpdated")
      ];
      const iconPanel = [
        select("Icon", attrs.icon, ICON_OPTIONS, (v) => set({ icon: v })),
        attrs.icon === "image" && h(
          MediaUploadCheck,
          null,
          h(MediaUpload, {
            onSelect: (m) => set({ iconUrl: m.url }),
            allowedTypes: ["image"],
            value: attrs.iconUrl,
            render: (r) => h(
              Fragment,
              null,
              attrs.iconUrl && h("img", { src: attrs.iconUrl, alt: "", style: { maxWidth: "64px", maxHeight: "64px", display: "block", marginBottom: "8px" } }),
              h(Button, { variant: "secondary", onClick: r.open }, attrs.iconUrl ? __("Replace image") : __("Choose image or SVG")),
              attrs.iconUrl && h(Button, { variant: "link", isDestructive: true, onClick: () => set({ iconUrl: "" }), style: { marginLeft: "8px" } }, __("Remove"))
            )
          })
        ),
        attrs.icon !== "none" && select("Layout", attrs.layout, LAYOUT_OPTIONS, (v) => set({ layout: v })),
        attrs.icon !== "none" && h(RangeControl, { label: __("Icon size"), min: 24, max: 160, step: 4, value: attrs.iconSize, onChange: (v) => set({ iconSize: v || DEFAULT_ATTRS.iconSize }), __nextHasNoMarginBottom: true }),
        attrs.icon !== "none" && toggle("Animate the icon", "animate"),
        attrs.icon !== "none" && attrs.icon !== "image" && h(PanelColorSettings, {
          title: __("Icon colour"),
          initialOpen: false,
          disableCustomColors: false,
          colorSettings: [{ label: __("Icon"), value: attrs.iconColor, onChange: (v) => set({ iconColor: v || "" }) }]
        })
      ];
      return h(
        Fragment,
        null,
        h(
          InspectorControls,
          null,
          h(PanelBody, { title: __("Reading"), initialOpen: true }, ...measurement),
          h(PanelBody, { title: __("Icon"), initialOpen: true }, ...iconPanel)
        ),
        h("div", useBlockProps(), h("div", { className: "acewd-reading", ref: host }))
      );
    }
    wp.blocks.registerBlockType(BLOCK_NAME, { edit: Edit, save: () => null });
  }

  // src/reading/editor-main.ts
  if (window.wp) {
    registerBlock(window.wp, window.ACE_WIND_BLOCK || ENV_FALLBACK);
  }
})();

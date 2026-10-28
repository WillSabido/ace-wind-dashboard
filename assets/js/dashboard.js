/* ACE Wind Turbine Dashboard – front end. Talks only to this site's REST proxy. */
(function () {
  "use strict";

  var RANGES = [
    [300, "Last 5 minutes"],
    [1800, "Last 30 minutes"],
    [3600, "Last hour"],
    [21600, "Last 6 hours"],
    [86400, "Last 24 hours"],
    [604800, "Last 7 days"],
    [2592000, "Last 30 days"],
    [7776000, "Last 90 days"],
    [31536000, "Last year"],
  ];
  var STYLES = [
    ["line", "Line"],
    ["area", "Area"],
    ["step", "Steps"],
  ];
  var RES_NAMES = {
    "1s": "1-second",
    "60s": "1-minute",
    "10m": "10-minute",
    daily: "daily",
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
    "NNW",
  ];
  var DOI = "https://doi.org/10.5281/zenodo.22662372";
  var ARROW =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l6 18-6-4-6 4z"/></svg>';

  /* ---------- helpers ---------- */

  function h(tag, attrs, kids) {
    var e = document.createElement(tag),
      k;
    attrs = attrs || {};
    for (k in attrs) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) {
      if (c) e.appendChild(c);
    });
    return e;
  }
  function nf(v, dp) {
    return v == null || isNaN(v)
      ? "–"
      : Number(v).toLocaleString("en-GB", {
          maximumFractionDigits: dp,
          minimumFractionDigits: 0,
        });
  }
  function clock(ts, tz, withSec) {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        second: withSec ? "2-digit" : undefined,
      }).format(new Date(ts * 1000));
    } catch (e) {
      return new Date(ts * 1000).toLocaleTimeString();
    }
  }
  function unitTxt(u) {
    return u ? " " + u : "";
  }

  var catPromises = {};
  function request(rest, path, params) {
    var qs = Object.keys(params || {})
      .filter(function (k) {
        return (
          params[k] !== undefined && params[k] !== null && params[k] !== ""
        );
      })
      .map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
      })
      .join("&");
    var url =
      rest + path + (qs ? (rest.indexOf("?") >= 0 ? "&" : "?") + qs : "");
    return fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "omit",
    }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (j) {
          if (!r.ok) {
            var e = new Error(j.error || "Request failed (" + r.status + ")");
            e.status = r.status;
            e.retry = parseInt(r.headers.get("Retry-After"), 10) || 0;
            throw e;
          }
          return j;
        });
    });
  }
  function catalogue(rest) {
    if (!catPromises[rest]) {
      catPromises[rest] = request(rest, "catalogue").catch(function (e) {
        delete catPromises[rest];
        throw e;
      });
    }
    return catPromises[rest];
  }

  /** Choose a data resolution for a span of seconds. Returns a resolution object or null. */
  function pickRes(resList, span) {
    var c = null,
      i,
      j,
      last;
    for (i = 0; i < resList.length; i++) {
      if (span / resList[i].seconds <= 2000) {
        c = resList[i];
        break;
      }
    }
    if (c) {
      // Too coarse (<60 points)? Use the finest resolution that stays within 5000 points.
      if (span / c.seconds < 60) {
        for (j = i - 1; j >= 0; j--) {
          if (span / resList[j].seconds <= 5000) c = resList[j];
          else break;
        }
      }
      return span / c.seconds >= 2 ? c : null;
    }
    last = resList[resList.length - 1];
    return span / last.seconds <= 12000 ? last : null;
  }

  /* ---------- dashboard ---------- */

  function Dash(el) {
    this.el = el;
    this.cfg = JSON.parse(el.getAttribute("data-config"));
    this.st = {
      family: null,
      asset: null,
      f1: null,
      f2: "",
      range: this.cfg.range,
      style: "line",
      live: true,
      cStart: null,
      cEnd: null,
    };
    this.plot = null;
    this.sig = "";
    this.last = null;
    this.timer = null;
    this.tileTimer = null;
    this.busy = false;
    this.fail = 0;
    var self = this;
    catalogue(this.cfg.rest).then(
      function (cat) {
        self.cat = cat;
        self.build();
      },
      function (e) {
        el.innerHTML = "";
        el.appendChild(
          h("p", {
            class: "acewd-error",
            text:
              "The turbine dashboard is temporarily unavailable. " +
              (e.message || ""),
          }),
        );
      },
    );
  }

  Dash.prototype.fam = function () {
    var f = this.st.family,
      i;
    for (i = 0; i < this.cat.families.length; i++)
      if (this.cat.families[i].family === f) return this.cat.families[i];
    return null;
  };
  Dash.prototype.famByName = function (n) {
    for (var i = 0; i < this.cat.families.length; i++)
      if (this.cat.families[i].family === n) return this.cat.families[i];
    return null;
  };

  Dash.prototype.build = function () {
    var self = this,
      c = this.cfg,
      el = this.el,
      st = this.st;
    el.innerHTML = "";

    // Initial selections (fall back gracefully if the API changes).
    var f0 = this.famByName(c.family) || this.cat.families[0];
    st.family = f0.family;
    st.asset = f0.assets[0] || null;
    var names = f0.fields.map(function (f) {
      return f.name;
    });
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

    // Tiles
    if (c.tiles) {
      this.tiles = {};
      var grid = h("div", { class: "acewd-tiles" });
      [
        ["power", "Power output"],
        ["wind", "Wind speed"],
        ["dir", "Wind direction"],
        ["rotor", "Rotor speed"],
      ].forEach(function (t) {
        var v = h("div", { class: "acewd-val", text: "–" }),
          s = h("div", { class: "acewd-sub" });
        var kids = [h("h3", { text: t[1] }), v, s];
        if (t[0] === "power") {
          var b = h("i");
          self.tiles.bar = b;
          kids.push(h("div", { class: "acewd-bar" }, [b]));
        }
        self.tiles[t[0]] = { v: v, s: s };
        grid.appendChild(h("div", { class: "acewd-tile" }, kids));
      });
      el.appendChild(grid);
    }

    // Controls
    this.ctl = {};
    if (c.controls) {
      var box = h("div", { class: "acewd-controls" });
      var add = function (key, label) {
        var id = "acewd-" + Math.random().toString(36).slice(2, 8);
        var sel = h("select", { id: id });
        var wrap = h("div", { class: "acewd-ctl" }, [
          h("label", { for: id, text: label }),
          sel,
        ]);
        self.ctl[key] = sel;
        self.ctl[key + "Wrap"] = wrap;
        box.appendChild(wrap);
        return sel;
      };
      add("family", "Data");
      add("asset", "Turbine / unit");
      add("f1", "Measurement");
      add("f2", "Compare with");
      add("range", "Time period");
      add("style", "Chart style");
      // Custom range inputs
      var cs = h("input", {
        type: "datetime-local",
        id: "acewd-cs-" + Math.random().toString(36).slice(2, 6),
      });
      var ce = h("input", {
        type: "datetime-local",
        id: "acewd-ce-" + Math.random().toString(36).slice(2, 6),
      });
      var go = h("button", {
        type: "button",
        class: "acewd-btn primary",
        text: "Show",
      });
      this.ctl.cs = cs;
      this.ctl.ce = ce;
      this.ctl.custom = h("div", { class: "acewd-custom" }, [
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
      box.appendChild(this.ctl.custom);
      el.appendChild(box);

      STYLES.forEach(function (s) {
        self.ctl.style.appendChild(h("option", { value: s[0], text: s[1] }));
      });
      this.ctl.family.addEventListener("change", function () {
        self.onFamily(this.value);
      });
      this.ctl.asset.addEventListener("change", function () {
        st.asset = this.value;
        self.reload();
      });
      this.ctl.f1.addEventListener("change", function () {
        st.f1 = this.value;
        self.fillF2();
        self.reload();
      });
      this.ctl.f2.addEventListener("change", function () {
        st.f2 = this.value;
        self.reload();
      });
      this.ctl.style.addEventListener("change", function () {
        st.style = this.value;
        self.reload();
      });
      this.ctl.range.addEventListener("change", function () {
        if (this.value === "custom") {
          self.ctl.custom.classList.add("show");
          if (!cs.value) {
            var now = new Date(),
              ago = new Date(now.getTime() - 86400000),
              p = function (d) {
                return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16);
              };
            cs.value = p(ago);
            ce.value = p(now);
          }
          return;
        }
        self.ctl.custom.classList.remove("show");
        st.range = parseInt(this.value, 10);
        st.cStart = st.cEnd = null;
        self.reload();
      });
      go.addEventListener("click", function () {
        var a = new Date(cs.value),
          b = new Date(ce.value);
        if (isNaN(a) || isNaN(b) || b <= a) {
          self.say("Please choose a valid start and end time.");
          return;
        }
        st.range = "custom";
        st.cStart = Math.floor(a / 1000);
        st.cEnd = Math.floor(b / 1000);
        self.reload();
      });
      this.fillFamily();
    }

    // Chart
    this.chartEl = h("div", { class: "acewd-chart" });
    this.msg = h("div", { class: "acewd-msg", role: "status" });
    el.appendChild(
      h("div", { class: "acewd-chartwrap" }, [this.chartEl, this.msg]),
    );

    // Bottom bar
    this.note = h("span", { class: "acewd-note", "aria-live": "polite" });
    this.liveBtn = h("button", {
      type: "button",
      class: "acewd-btn",
      text: "Pause",
    });
    var dl = h("button", {
      type: "button",
      class: "acewd-btn",
      text: "Download CSV",
    });
    this.liveBtn.addEventListener("click", function () {
      st.live = !st.live;
      self.liveBtn.textContent = st.live ? "Pause" : "Resume live";
      if (st.live) self.reload();
      else clearTimeout(self.timer);
    });
    dl.addEventListener("click", function () {
      self.csv();
    });
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
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (self.plot)
          self.plot.setSize({
            width: self.chartEl.clientWidth,
            height: self.cfg.height,
          });
      }).observe(this.chartEl);
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        self.tick();
        if (st.live) self.reload();
      }
    });

    this.syncControls();
    this.tick();
    this.reload();
  };

  /* ---- menu population ---- */

  Dash.prototype.fillFamily = function () {
    var s = this.ctl.family;
    this.cat.families.forEach(function (f) {
      s.appendChild(h("option", { value: f.family, text: f.label }));
    });
  };
  Dash.prototype.fillFields = function () {
    var f = this.fam(),
      s = this.ctl.f1;
    s.innerHTML = "";
    f.fields.forEach(function (x) {
      s.appendChild(
        h("option", {
          value: x.name,
          text: x.label + (x.unit ? " (" + x.unit + ")" : ""),
        }),
      );
    });
  };
  Dash.prototype.fillF2 = function () {
    var f = this.fam(),
      s = this.ctl.f2,
      st = this.st;
    s.innerHTML = "";
    s.appendChild(h("option", { value: "", text: "None" }));
    f.fields.forEach(function (x) {
      if (x.name !== st.f1)
        s.appendChild(
          h("option", {
            value: x.name,
            text: x.label + (x.unit ? " (" + x.unit + ")" : ""),
          }),
        );
    });
    if (st.f2 === st.f1) st.f2 = "";
    s.value = st.f2;
  };
  Dash.prototype.fillAssets = function () {
    var f = this.fam(),
      s = this.ctl.asset,
      cat = this.cat;
    s.innerHTML = "";
    f.assets.forEach(function (id) {
      var name = id;
      cat.assets.forEach(function (a) {
        if (a.id === id) name = a.name;
      });
      s.appendChild(h("option", { value: id, text: name }));
    });
    this.ctl.assetWrap.style.display = f.assets.length > 1 ? "" : "none";
  };
  Dash.prototype.fillRanges = function () {
    var f = this.fam(),
      s = this.ctl.range,
      st = this.st,
      firstOk = null;
    s.innerHTML = "";
    RANGES.forEach(function (r) {
      var ok = !!pickRes(f.resolutions, r[0]);
      var o = h("option", { value: r[0], text: r[1] + (ok ? "" : " (n/a)") });
      if (!ok) o.disabled = true;
      else if (firstOk === null) firstOk = r[0];
      s.appendChild(o);
    });
    s.appendChild(h("option", { value: "custom", text: "Custom range…" }));
    if (st.range !== "custom") {
      if (!pickRes(f.resolutions, st.range)) {
        // Nearest available preset.
        var best = null,
          d = Infinity;
        RANGES.forEach(function (r) {
          if (
            pickRes(f.resolutions, r[0]) &&
            Math.abs(Math.log(r[0] / st.range)) < d
          ) {
            d = Math.abs(Math.log(r[0] / st.range));
            best = r[0];
          }
        });
        st.range = best || firstOk || RANGES[0][0];
      }
    }
  };
  Dash.prototype.syncControls = function () {
    if (!this.cfg.controls) return;
    var st = this.st;
    this.fillAssets();
    this.fillFields();
    this.fillRanges();
    this.ctl.family.value = st.family;
    if (st.asset) this.ctl.asset.value = st.asset;
    this.ctl.f1.value = st.f1;
    this.fillF2();
    this.ctl.range.value = String(st.range);
    this.ctl.style.value = st.style;
  };
  Dash.prototype.onFamily = function (name) {
    var st = this.st;
    st.family = name;
    var f = this.fam();
    st.asset = f.assets[0] || null;
    var names = f.fields.map(function (x) {
      return x.name;
    });
    // Keep the same measurement name if it exists (e.g. active_power_mean), else take the first.
    st.f1 = names.indexOf(st.f1) >= 0 ? st.f1 : names[0];
    if (names.indexOf(st.f2) < 0) st.f2 = "";
    this.syncControls();
    this.reload();
  };

  /* ---- status chip + tiles ---- */

  Dash.prototype.setChip = function (cls, text) {
    this.chip.className = "acewd-chip " + cls;
    this.chip.textContent = text;
  };

  Dash.prototype.tick = function () {
    var self = this,
      c = this.cfg;
    clearTimeout(this.tileTimer);
    if (document.hidden) {
      return;
    }
    var site = this.famByName("site_instantaneous"),
      wec = this.famByName("wec_instantaneous");
    var reqs = [];
    if (site)
      reqs.push(
        request(c.rest, "data", {
          family: "site_instantaneous",
          resolution: "1s",
          limit: 5,
          fields:
            "aggregate_active_power,aggregate_wind_speed,aggregate_wind_direction",
        }),
      );
    else reqs.push(Promise.resolve(null));
    if (wec)
      reqs.push(
        request(c.rest, "data", {
          family: "wec_instantaneous",
          resolution: "1s",
          limit: 5,
          asset: wec.assets[0],
          fields: "wec_rotor_speed",
        }).catch(function () {
          return null;
        }),
      );
    else reqs.push(Promise.resolve(null));

    Promise.all(reqs)
      .then(function (r) {
        self.tileFail = 0;
        self.showTiles(r[0], r[1]);
      })
      .catch(function (e) {
        self.tileFail = (self.tileFail || 0) + 1;
        if (e && e.retry) self.tileDelay = e.retry * 1000;
        self.setChip("warn", "Data unavailable");
      })
      .then(function () {
        var base = Math.max(1, c.liveRefresh) * 1000;
        var delay =
          self.tileDelay ||
          Math.min(60000, base * Math.pow(2, Math.min(self.tileFail || 0, 5)));
        self.tileDelay = 0;
        self.tileTimer = setTimeout(function () {
          self.tick();
        }, delay);
      });
  };

  function lastVal(d, f) {
    if (!d || !d.series || !d.series[f]) return null;
    for (var i = d.series[f].length - 1; i >= 0; i--) {
      if (d.series[f][i] != null)
        return { v: d.series[f][i], t: d.timestamps[i] };
    }
    return null;
  }

  Dash.prototype.showTiles = function (s, w) {
    var c = this.cfg,
      p = lastVal(s, "aggregate_active_power"),
      ws = lastVal(s, "aggregate_wind_speed"),
      wd = lastVal(s, "aggregate_wind_direction"),
      rr = lastVal(w, "wec_rotor_speed");
    var newest = 0;
    [p, ws, wd, rr].forEach(function (x) {
      if (x && x.t > newest) newest = x.t;
    });

    if (!newest) {
      this.setChip("warn", "No recent data");
    } else {
      var age = Date.now() / 1000 - newest;
      if (age > 180)
        this.setChip(
          "warn",
          "Data delayed – last reading " + clock(newest, c.tz, false),
        );
      else if (p && p.v > 5)
        this.setChip("on", "Generating · updated " + clock(newest, c.tz, true));
      else
        this.setChip(
          "",
          "Not generating · updated " + clock(newest, c.tz, true),
        );
    }
    if (!c.tiles) return;
    var t = this.tiles;
    if (p) {
      t.power.v.innerHTML = nf(p.v, 0) + "<small>kW</small>";
      var pct = Math.max(0, Math.min(100, (p.v / c.ratedKw) * 100));
      t.power.s.textContent =
        nf(pct, 0) + "% of " + nf(c.ratedKw / 1000, 1) + " MW rated output";
      t.bar.style.width = pct + "%";
    }
    if (ws) {
      t.wind.v.innerHTML = nf(ws.v, 1) + "<small>m/s</small>";
      t.wind.s.textContent = nf(ws.v * 2.23694, 1) + " mph";
    }
    if (wd) {
      var deg = ((wd.v % 360) + 360) % 360;
      // Arrow points the way the wind is blowing TO (direction is where it comes FROM).
      t.dir.v.innerHTML =
        '<span class="acewd-arrow" style="transform:rotate(' +
        (deg + 180) +
        'deg)">' +
        ARROW +
        "</span>" +
        COMPASS[Math.round(deg / 22.5) % 16] +
        "<small>" +
        nf(deg, 0) +
        "°</small>";
      t.dir.s.textContent =
        "Wind blowing from the " + COMPASS[Math.round(deg / 22.5) % 16];
    }
    if (rr) {
      t.rotor.v.innerHTML = nf(rr.v, 1) + "<small>rpm</small>";
      t.rotor.s.textContent = rr.v > 0.5 ? "Rotor turning" : "Rotor stationary";
    }
  };

  /* ---- chart ---- */

  Dash.prototype.say = function (text) {
    this.msg.textContent = text || "";
    this.msg.classList.toggle("show", !!text);
  };

  Dash.prototype.reload = function () {
    clearTimeout(this.timer);
    this.fail = 0;
    this.load(true);
  };

  Dash.prototype.load = function (showSpin) {
    var self = this,
      st = this.st,
      f = this.fam(),
      cfg = this.cfg;
    if (this.busy) {
      this.pending = true;
      return;
    }
    var span = st.range === "custom" ? st.cEnd - st.cStart : st.range;
    var res = pickRes(f.resolutions, span);
    if (!res) {
      this.say(
        "That time period isn’t available for this data. Please choose another.",
      );
      return;
    }
    var fields = [st.f1].concat(st.f2 ? [st.f2] : []);
    var params = {
      family: st.family,
      resolution: res.resolution,
      fields: fields.join(","),
      asset: f.scope === "asset" ? st.asset : "",
    };
    if (st.range === "custom") {
      params.start = new Date(st.cStart * 1000)
        .toISOString()
        .replace(/\.\d+Z$/, "Z");
      params.end = new Date(st.cEnd * 1000)
        .toISOString()
        .replace(/\.\d+Z$/, "Z");
    } else {
      params.span = span;
    }

    this.busy = true;
    if (showSpin && !this.plot) this.say("Loading chart…");
    request(cfg.rest, "data", params)
      .then(function (d) {
        self.busy = false;
        self.fail = 0;
        // Ignore late replies if the selection changed meanwhile (a reload is already queued).
        if (
          self.pending ||
          st.family !== params.family ||
          st.f1 !== fields[0] ||
          (st.f2 || "") !== (fields[1] || "")
        )
          return;
        self.render(d, fields, res, f);
      })
      .catch(function (e) {
        self.busy = false;
        self.fail++;
        self.say(
          e.status === 429
            ? "The data service is busy – retrying…"
            : "Couldn’t load data – retrying…",
        );
        if (e.retry) self.retryAfter = e.retry * 1000;
      })
      .then(function () {
        if (self.pending) {
          self.pending = false;
          self.load(true);
        } else {
          self.schedule(res);
        }
      });
  };

  Dash.prototype.schedule = function (res) {
    var self = this,
      st = this.st,
      cfg = this.cfg;
    clearTimeout(this.timer);
    if (!st.live || st.range === "custom") return;
    var base =
      res.seconds <= 1
        ? Math.max(1, cfg.liveRefresh)
        : Math.max(res.refresh, 5);
    var delay = this.fail
      ? Math.min(60000, base * 1000 * Math.pow(2, Math.min(this.fail, 5)))
      : base * 1000;
    if (this.retryAfter) {
      delay = Math.max(delay, this.retryAfter);
      this.retryAfter = 0;
    }
    this.timer = setTimeout(function () {
      if (document.hidden) {
        self.schedule(res);
      } else {
        self.load(false);
      }
    }, delay);
  };

  Dash.prototype.render = function (d, fields, res, fam) {
    var self = this,
      st = this.st,
      cfg = this.cfg;
    var ts = d.timestamps.slice(),
      cols = fields.map(function (k) {
        return (d.series[k] || []).slice();
      });

    // Ensure ascending time order.
    var sorted = true,
      i;
    for (i = 1; i < ts.length; i++)
      if (ts[i] < ts[i - 1]) {
        sorted = false;
        break;
      }
    if (!sorted) {
      var idx = ts
        .map(function (_, k) {
          return k;
        })
        .sort(function (a, b) {
          return ts[a] - ts[b];
        });
      ts = idx.map(function (k) {
        return ts[k];
      });
      cols = cols.map(function (c) {
        return idx.map(function (k) {
          return c[k];
        });
      });
    }
    if (
      !ts.length ||
      cols.every(function (c) {
        return c.every(function (v) {
          return v == null;
        });
      })
    ) {
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
    this.say("");
    this.last = {
      ts: ts,
      cols: cols,
      fields: fields,
      meta: d.fields,
      family: d.family,
    };

    var m1 = d.fields[fields[0]],
      m2 = fields[1] ? d.fields[fields[1]] : null;
    var sepAxis = !!m2 && (m2.unit || "") !== (m1.unit || "");
    var sig = [st.family, st.asset, fields.join(","), st.style, sepAxis].join(
      "|",
    );
    var data = [ts].concat(cols);

    if (this.plot && sig === this.sig) {
      this.plot.setData(data, true);
    } else {
      if (this.plot) this.plot.destroy();
      this.chartEl.innerHTML = "";
      this.sig = sig;
      var tz = cfg.tz;
      var mk = function (m, color, scale) {
        var s = {
          label: m.label + (m.unit ? " (" + m.unit + ")" : ""),
          stroke: color,
          width: 2,
          scale: scale,
          spanGaps: false,
          points: { show: false },
          value: function (u, v) {
            return v == null ? "–" : nf(v, 2);
          },
        };
        if (st.style === "area") s.fill = color + "30";
        if (
          st.style === "step" &&
          window.uPlot.paths &&
          window.uPlot.paths.stepped
        )
          s.paths = window.uPlot.paths.stepped({ align: 1 });
        return s;
      };
      var series = [
        {
          label: "Time",
          value: function (u, v) {
            return v == null
              ? ""
              : new Intl.DateTimeFormat("en-GB", {
                  timeZone: tz,
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }).format(new Date(v * 1000));
          },
        },
        mk(m1, COLORS[0], "y"),
      ];
      var axes = [
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
      var scales = { x: { time: true }, y: { auto: true } };
      if (m2) {
        series.push(mk(m2, COLORS[1], sepAxis ? "y2" : "y"));
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
      this.plot = new window.uPlot(
        {
          width: Math.max(280, this.chartEl.clientWidth),
          height: cfg.height,
          tzDate: function (t) {
            return window.uPlot.tzDate(new Date(t * 1000), tz);
          },
          series: series,
          axes: axes,
          scales: scales,
          cursor: { drag: { x: true, y: false } },
          legend: { show: true },
        },
        data,
        this.chartEl,
      );
    }
    var n = ts.length;
    this.note.textContent =
      "Showing " +
      (RES_NAMES[d.resolution] || d.resolution) +
      " data · " +
      nf(n, 0) +
      " points" +
      (d.truncated ? " (shortened)" : "") +
      (st.live && st.range !== "custom" ? " · live" : "") +
      " · drag to zoom, double-click to reset";
  };

  Dash.prototype.csv = function () {
    var L = this.last;
    if (!L) return;
    var q = function (s) {
      return '"' + String(s).replace(/"/g, '""') + '"';
    };
    var rows = [
      "# Source: Ambition Community Energy (ACE) - ACE Wind Turbine Data, CC BY 4.0, " +
        DOI,
    ];
    rows.push(
      ["Time (UTC)"]
        .concat(
          L.fields.map(function (k) {
            var m = L.meta[k];
            return q(m.label + (m.unit ? " (" + m.unit + ")" : ""));
          }),
        )
        .join(","),
    );
    L.ts.forEach(function (t, i) {
      rows.push(
        [new Date(t * 1000).toISOString()]
          .concat(
            L.cols.map(function (c) {
              return c[i] == null ? "" : c[i];
            }),
          )
          .join(","),
      );
    });
    var url = URL.createObjectURL(
      new Blob([rows.join("\n")], { type: "text/csv" }),
    );
    var a = h("a", {
      href: url,
      download: "ace-wind-" + L.family + "-" + L.fields[0] + ".csv",
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  };

  function init() {
    var els = document.querySelectorAll(".acewd[data-config]");
    Array.prototype.forEach.call(els, function (el) {
      new Dash(el);
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();

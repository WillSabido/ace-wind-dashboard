import { LIMITS } from "./constants";
import type { DataResponse, FieldInfo, Latest, Resolution } from "./types";

/* ---------- DOM ---------- */

export type Attrs = Record<string, string | number>;
export type Kid = Node | null | undefined | false;

/** Create an element. Special attrs: `text` (textContent) and `html` (innerHTML). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  kids: Kid[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
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

let uidCounter = 0;
/** Page-unique element id, so labels never point at another dashboard's control. */
export function uid(prefix: string): string {
  uidCounter += 1;
  return "acewd-" + prefix + "-" + uidCounter;
}

/* ---------- formatting ---------- */

/** Format a number for display; null/NaN/non-numeric become an en dash. */
export function nf(v: number | string | null | undefined, dp: number): string {
  return v == null || isNaN(v as number)
    ? "–"
    : Number(v).toLocaleString("en-GB", {
        maximumFractionDigits: dp,
        minimumFractionDigits: 0,
      });
}

/** Time of day (HH:MM[:SS]) for a Unix time in seconds, in the given IANA time zone. */
export function clock(ts: number, tz: string, withSec: boolean): string {
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

/** "Mean wind speed (m/s)", or just the label when the field has no unit. */
export function fieldLabel(f: FieldInfo): string {
  return f.label + (f.unit ? " (" + f.unit + ")" : "");
}

/* ---------- data ---------- */

/**
 * Choose a data resolution for a time span in seconds, or null if none is suitable.
 * Prefers the finest resolution that fits the API's single-call "latest" limit; steps down
 * to finer data when the coarse choice would give too few points.
 */
export function pickRes(list: Resolution[], span: number): Resolution | null {
  let chosen: Resolution | null = null;
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

/** Newest non-null value of a field in a response, with its timestamp. */
export function lastVal(
  d: Pick<DataResponse, "series" | "timestamps"> | null | undefined,
  field: string,
): Latest | null {
  if (!d || !d.series || !d.series[field]) return null;
  const col = d.series[field];
  for (let i = col.length - 1; i >= 0; i--) {
    const v = col[i];
    if (v != null) return { v, t: d.timestamps[i] };
  }
  return null;
}

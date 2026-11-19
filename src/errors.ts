import type { ErrorInfo } from "./api";

/** A failed request, turned into something a visitor can act on. */
export interface Explained {
  /** Worth trying again automatically (network trouble, busy or failing server)? */
  retryable: boolean;
  title: string;
  /** What the data service (or the plugin) said, as a sentence. */
  reason: string;
  /** What the visitor can do about it. */
  hint: string;
  /** Short technical reference for support, e.g. "HTTP 400 · ace_upstream". */
  tech: string;
}

/** Add a full stop unless the text already ends in punctuation. */
export function sentence(text: string): string {
  const t = text.trim();
  return t === "" ? "" : /[.!?]$/.test(t) ? t : t + ".";
}

const PERIOD_CODES = ["ace_too_many", "ace_bad_range"];
const SELECTION_CODES = [
  "ace_bad_fields",
  "ace_bad_family",
  "ace_bad_asset",
  "ace_bad_resolution",
];

/**
 * Errors the visitor can't fix by waiting (the data service rejected the request) are not retryable:
 * repeating the identical request would fail the same way. Network failures, rate limits and 5xx are.
 */
export function explainError(info: ErrorInfo): Explained {
  const status = info.status;
  const clientError =
    status !== undefined && status >= 400 && status < 500 && status !== 429;

  let hint = "Try a shorter time period or a different measurement.";
  if (info.code && PERIOD_CODES.indexOf(info.code) >= 0)
    hint = "Try a shorter time period.";
  else if (info.code && SELECTION_CODES.indexOf(info.code) >= 0)
    hint = "Try a different measurement or data set.";

  return {
    retryable: !clientError,
    title: "This chart can’t be shown",
    reason: sentence(info.message) || "The data service rejected the request.",
    hint,
    tech: [status !== undefined ? "HTTP " + status : "", info.code]
      .filter((x) => x)
      .join(" · "),
  };
}

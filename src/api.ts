import type { Catalogue } from "./types";

/** An error response from the plugin's REST proxy (or a network failure wrapped the same way). */
export class ApiError extends Error {
  readonly status: number;
  /** Seconds the server asked us to wait (Retry-After), or 0. */
  readonly retry: number;

  constructor(message: string, status: number, retry: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retry = retry;
  }
}

/** Pull message/status/retry from anything that was thrown, without assuming it is an ApiError. */
export function errorInfo(e: unknown): {
  message: string;
  status: number | undefined;
  retry: number;
} {
  const o = (e && typeof e === "object" ? e : {}) as {
    message?: unknown;
    status?: unknown;
    retry?: unknown;
  };
  return {
    message: typeof o.message === "string" ? o.message : "",
    status: typeof o.status === "number" ? o.status : undefined,
    retry: typeof o.retry === "number" ? o.retry : 0,
  };
}

export type Params = Record<string, string | number | null | undefined>;

/** GET `rest + path` with the given query (empty values are omitted). Rejects with ApiError. */
export function request<T>(
  rest: string,
  path: string,
  params: Params = {},
): Promise<T> {
  const qs = Object.keys(params)
    .filter(
      (k) => params[k] !== undefined && params[k] !== null && params[k] !== "",
    )
    .map(
      (k) =>
        encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])),
    )
    .join("&");
  // Plain permalinks give a REST base like "?rest_route=/ace-wind/v1/", which already has a "?".
  const url =
    rest + path + (qs ? (rest.indexOf("?") >= 0 ? "&" : "?") + qs : "");

  return fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "omit",
  }).then((r) =>
    r
      .json()
      .catch(() => ({}))
      .then((j: { error?: string }) => {
        if (!r.ok) {
          throw new ApiError(
            j.error || "Request failed (" + r.status + ")",
            r.status,
            parseInt(r.headers.get("Retry-After") || "", 10) || 0,
          );
        }
        return j as unknown as T;
      }),
  );
}

const catalogues: Record<string, Promise<Catalogue>> = {};

/** The data-set catalogue, fetched once per page; a failed fetch is not cached. */
export function catalogue(rest: string): Promise<Catalogue> {
  if (!catalogues[rest]) {
    catalogues[rest] = request<Catalogue>(rest, "catalogue").catch(
      (e: unknown) => {
        delete catalogues[rest];
        throw e;
      },
    );
  }
  return catalogues[rest];
}

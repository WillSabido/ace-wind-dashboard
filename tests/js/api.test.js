/** The typed fetch wrapper: URL building, error mapping and the catalogue cache. */
const {
  REST,
  jsonResponse,
  catalogue: catalogueFixture,
} = require("./helpers");

function load() {
  let api;
  jest.isolateModules(() => {
    api = require("../../src/api");
  });
  return api;
}
const mockFetch = (impl) => {
  global.fetch = jest.fn(impl);
  return global.fetch;
};

describe("request(): URL building", () => {
  test('appends non-empty params after "?" and URL-encodes them', async () => {
    const f = mockFetch(() => Promise.resolve(jsonResponse({ ok: 1 })));
    await load().request(REST, "data", { a: 1, e: "x y&z", fields: "p,q" });
    expect(f.mock.calls[0][0]).toBe(REST + "data?a=1&e=x%20y%26z&fields=p%2Cq");
  });

  test("omits empty, null and undefined params", async () => {
    const f = mockFetch(() => Promise.resolve(jsonResponse({})));
    await load().request(REST, "data", {
      keep: 0,
      empty: "",
      nul: null,
      undef: undefined,
    });
    expect(f.mock.calls[0][0]).toBe(REST + "data?keep=0");
  });

  test("no params means no query string", async () => {
    const f = mockFetch(() => Promise.resolve(jsonResponse({})));
    await load().request(REST, "catalogue");
    expect(f.mock.calls[0][0]).toBe(REST + "catalogue");
  });

  test('plain permalinks: a REST base that already contains "?" continues with "&"', async () => {
    const base = "https://example.test/?rest_route=/ace-wind/v1/";
    const f = mockFetch(() => Promise.resolve(jsonResponse({})));
    await load().request(base, "data", { family: "wecstd" });
    expect(f.mock.calls[0][0]).toBe(base + "data&family=wecstd");
    await load().request(base, "catalogue");
    expect(f.mock.calls[1][0]).toBe(base + "catalogue");
  });

  test("sends JSON Accept header, no credentials, and bypasses the browser HTTP cache", async () => {
    const f = mockFetch(() => Promise.resolve(jsonResponse({})));
    await load().request(REST, "catalogue");
    expect(f.mock.calls[0][1]).toEqual({
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
    });
  });

  test("resolves with the parsed body", async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ hello: "world" })));
    await expect(load().request(REST, "x")).resolves.toEqual({
      hello: "world",
    });
  });
});

describe("request(): errors", () => {
  test("a non-OK response rejects with an ApiError carrying server message and status", async () => {
    mockFetch(() =>
      Promise.resolve(jsonResponse({ error: "Unknown measurement." }, 400)),
    );
    const { request, ApiError } = load();
    const e = await request(REST, "data").catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ApiError");
    expect([e.message, e.status, e.retry]).toEqual([
      "Unknown measurement.",
      400,
      0,
    ]);
  });

  test("parses Retry-After into seconds", async () => {
    mockFetch(() =>
      Promise.resolve(
        jsonResponse({ error: "busy" }, 429, { "Retry-After": "30" }),
      ),
    );
    const e = await load()
      .request(REST, "data")
      .catch((x) => x);
    expect([e.status, e.retry]).toEqual([429, 30]);
  });

  test("an unparseable Retry-After is treated as none", async () => {
    mockFetch(() =>
      Promise.resolve(
        jsonResponse({ error: "busy" }, 429, { "Retry-After": "soon" }),
      ),
    );
    expect(
      (
        await load()
          .request(REST, "data")
          .catch((x) => x)
      ).retry,
    ).toBe(0);
  });

  test("a non-JSON error body falls back to a generic message with the status", async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        headers: { get: () => null },
        json: () => Promise.reject(new SyntaxError("bad json")),
      }),
    );
    const e = await load()
      .request(REST, "data")
      .catch((x) => x);
    expect([e.message, e.status]).toEqual(["Request failed (500)", 500]);
  });

  test("network failures propagate unchanged", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(load().request(REST, "data")).rejects.toThrow(
      "Failed to fetch",
    );
  });
});

describe("errorInfo()", () => {
  const { errorInfo } = load();
  test("reads an ApiError", () => {
    const { ApiError } = load();
    expect(errorInfo(new ApiError("boom", 429, 7))).toEqual({
      message: "boom",
      status: 429,
      retry: 7,
    });
  });
  test("reads a plain Error (no status, no retry)", () => {
    expect(errorInfo(new Error("offline"))).toEqual({
      message: "offline",
      status: undefined,
      retry: 0,
    });
  });
  test.each([[null], [undefined], ["a string"], [42], [{}]])(
    "copes with %p",
    (v) => {
      expect(errorInfo(v)).toEqual({
        message: "",
        status: undefined,
        retry: 0,
      });
    },
  );
});

describe("catalogue()", () => {
  test("is fetched once per REST base and shared", async () => {
    const f = mockFetch(() =>
      Promise.resolve(jsonResponse(catalogueFixture())),
    );
    const { catalogue } = load();
    const [a, b] = await Promise.all([catalogue(REST), catalogue(REST)]);
    await catalogue(REST);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    await catalogue("https://other.test/wp-json/ace-wind/v1/");
    expect(f).toHaveBeenCalledTimes(2);
  });

  test("a failure is not cached, so the next call retries", async () => {
    let n = 0;
    const f = mockFetch(() =>
      Promise.resolve(
        ++n === 1
          ? jsonResponse({ error: "blip" }, 502)
          : jsonResponse(catalogueFixture()),
      ),
    );
    const { catalogue } = load();
    await expect(catalogue(REST)).rejects.toThrow("blip");
    await expect(catalogue(REST)).resolves.toHaveProperty("families");
    expect(f).toHaveBeenCalledTimes(2);
  });
});

import type { FetchLike } from "./client.js";

export interface StubResponse {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

type Route = StubResponse | Error | ((url: string) => StubResponse | Error);

/**
 * A fetch stand-in for tests. Routes are matched by URL prefix; a route given
 * as an array is consumed one response per call, which is how retry tests
 * describe "fail twice, then succeed".
 */
export class StubFetch {
  readonly calls: { url: string; headers: Record<string, string> }[] = [];
  private readonly routes: [string, Route | Route[]][] = [];

  on(urlPrefix: string, route: Route | Route[]): this {
    this.routes.push([urlPrefix, Array.isArray(route) ? [...route] : route]);
    return this;
  }

  readonly fetch: FetchLike = (url, init) => {
    this.calls.push({ url, headers: { ...(init.headers as Record<string, string>) } });

    // Longest prefix wins, so a specific route can sit alongside a catch-all.
    const match = this.routes
      .filter(([prefix]) => url.startsWith(prefix))
      .sort((a, b) => b[0].length - a[0].length)[0];
    if (match === undefined) {
      return Promise.reject(new Error(`StubFetch: no route for ${url}`));
    }

    let route = match[1];
    if (Array.isArray(route)) {
      const next = route.shift();
      if (next === undefined) {
        return Promise.reject(new Error(`StubFetch: route for ${url} ran out of responses`));
      }
      route = next;
    }

    const resolved = typeof route === "function" ? route(url) : route;
    if (resolved instanceof Error) return Promise.reject(resolved);

    const body =
      typeof resolved.body === "string" ? resolved.body : JSON.stringify(resolved.body ?? null);
    return Promise.resolve(
      new Response(body, { status: resolved.status ?? 200, headers: resolved.headers ?? {} }),
    );
  };
}

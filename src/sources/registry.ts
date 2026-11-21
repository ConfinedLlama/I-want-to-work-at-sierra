import { ashbySource } from "./ashby.js";
import { createGithubSource } from "./github.js";
import { greenhouseSource } from "./greenhouse.js";
import { hackerNewsSource } from "./hackernews.js";
import { leverSource } from "./lever.js";
import type { DiscoverySource, EnrichmentSource, SourceInfo } from "./types.js";
import { ycSource } from "./yc.js";

export interface SourceRegistry {
  readonly discovery: readonly DiscoverySource[];
  readonly enrichment: readonly EnrichmentSource[];
}

export interface RegistryOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Restrict to these source ids. Unknown ids are reported, not ignored. */
  readonly only?: readonly string[] | undefined;
}

export class UnknownSourceError extends Error {
  override readonly name = "UnknownSourceError";
  constructor(
    readonly unknown: readonly string[],
    readonly known: readonly string[],
  ) {
    super(
      `Unknown source ${unknown.map((id) => `"${id}"`).join(", ")}. Known: ${known.join(", ")}.`,
    );
  }
}

/** Every source the pipeline knows about, wired with whatever the environment offers. */
export function createRegistry(options: RegistryOptions = {}): SourceRegistry {
  const env = options.env ?? {};
  const all: SourceRegistry = {
    discovery: [ycSource, hackerNewsSource],
    enrichment: [
      greenhouseSource,
      leverSource,
      ashbySource,
      createGithubSource({ token: env.GITHUB_TOKEN }),
    ],
  };
  if (options.only === undefined) return all;

  const wanted = new Set(
    options.only.map((id) => id.trim().toLowerCase()).filter((id) => id !== ""),
  );
  const known = listSources(all).map((source) => source.id);
  const unknown = [...wanted].filter((id) => !known.includes(id));
  if (unknown.length > 0) throw new UnknownSourceError(unknown, known);

  return {
    discovery: all.discovery.filter((source) => wanted.has(source.info.id)),
    enrichment: all.enrichment.filter((source) => wanted.has(source.info.id)),
  };
}

export function listSources(registry: SourceRegistry): (SourceInfo & { role: string })[] {
  return [
    ...registry.discovery.map((source) => ({ ...source.info, role: "discovery" })),
    ...registry.enrichment.map((source) => ({ ...source.info, role: "enrichment" })),
  ];
}

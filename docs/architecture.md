# Architecture

This is how the code is laid out and why.
It describes what exists.
Plans live in [ROADMAP.md](../ROADMAP.md).

## The shape of a run

```
loadIcp ──► registry.discovery[] ──► mergeCandidates ──► rank + cap ──► registry.enrichment[] ──► report
              (yc, hackernews)        one Prospect          top N         (boards, github)
                                      per company
```

1. `src/icp` parses the profile, canonicalizes it and rejects profiles that cannot be searched.
2. Every discovery source runs in parallel and returns `CompanyCandidate[]`.
3. `mergeCandidates` folds candidates into one `Prospect` per company.
4. Prospects are ranked and cut to `--max`, so enrichment requests are only spent on the ones we will keep.
5. Each kept prospect goes through every enrichment source, a few prospects at a time.
6. The result is a `DiscoveryReport`: prospects, failures and counts.

## Modules

| Path            | Owns                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| `src/core`      | `Result`, the injectable clock, domain and name normalization, the concurrency helper |
| `src/text`      | Term matching on word boundaries, HTML to text, truncation                            |
| `src/http`      | The only network client: timeout, retry, rate limit, cache                            |
| `src/icp`       | The profile schema and loader                                                         |
| `src/sources`   | One file per source, the shared job board logic, the registry                         |
| `src/discovery` | Merging, ranking and the orchestrator                                                 |
| `src/cli`       | Argument parsing, runtime wiring, output formatting                                   |

Dependencies point one way: `cli` uses `discovery`, which uses `sources`, which use `http`, `text` and `core`.
Nothing below `cli` reads the environment, the wall clock or the real network on its own.
Those are passed in, which is what lets the whole pipeline run in tests with a fake clock and a stubbed fetch.

## Decisions worth knowing about

### Failures are values

Anything that can fail for reasons outside the code returns a `Result`.
A source being down is expected, so it should be a branch the caller handles and not an exception that unwinds the run.
The orchestrator still wraps each source in a `try`, because a bug in one source must not hide the results of the others.

### Two kinds of source

A discovery source answers "who fits this ICP".
An enrichment source answers "what else is true about this company".
Keeping them separate means enrichment can be capped to the prospects we keep, which matters when an API allows 60 requests an hour.

### Every signal has a URL

A `Signal` without a link to where it was observed cannot be constructed.
Research and outreach later depend on being able to say where a claim came from, and that is far easier to guarantee at the point of collection than to reconstruct afterwards.

### Matching is on word boundaries

`matchTerms` only matches a term that is not glued to another letter or digit.
The Hacker News search API is fuzzy, so every hit is re-checked locally.
This is the difference between a prospect list and a list of companies that send invoices.

### Guessing is allowed, trusting a guess is not

Job boards and GitHub are keyed by a slug the company chose.
When the ICP or a link in a post gives us the slug, it is used as is.
When we have to guess from the domain, GitHub results are only accepted if the org's website points back to the company's domain.

### Politeness is built into the client

Per-host spacing, `Retry-After`, a capped backoff and a response cache live in `HttpClient`, so no source can forget them.
An enrichment source that fails three times in a row is switched off for the rest of the run.

## Testing

Unit tests sit next to the code as `*.test.ts`.
Sources are tested against `StubFetch` with response shapes copied from the real APIs.
`src/cli/main.test.ts` drives the CLI entry point with a stubbed runtime, which covers the path from arguments to printed report.

Live runs against the real APIs are how the gaps listed in the roadmap were found.
They are done by hand for now.

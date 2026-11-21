# outbound

An outbound engagement pipeline I am building in the open.

You give it an ideal customer profile.
It goes and finds companies that fit, works out who to talk to and what they are building right now, and then runs a multi-step sequence where the phone call is handled by a voice agent rather than a person reading a script.

The voice side is deliberately modelled on how Sierra describes its own platform: declarative journeys, supervisors that watch the agent rather than a single giant prompt, a cascaded speech pipeline, and simulations that gate every release.
I want to understand that design by building a small version of it end to end, on a problem where I can tell whether it works.

## Where it is today

This is early.
The honest status of each stage:

| Stage     | What it does                                            | Status               |
| --------- | ------------------------------------------------------- | -------------------- |
| ICP       | Parse and validate an ideal customer profile            | working              |
| Sources   | Pull company signals from public APIs                   | working, six sources |
| Discovery | Fan out over sources, dedupe, merge into prospects      | working              |
| Research  | Per-prospect research agents that build a cited dossier | planned              |
| Scoring   | Rank prospects by fit and by why-now                    | planned              |
| Sequence  | Multi-step, multi-channel outreach with stop conditions | planned              |
| Voice     | Journeys, supervisors, cascaded STT to LLM to TTS       | planned              |
| Sims      | Simulated callers and pass^k reliability gates          | planned              |

[ROADMAP.md](ROADMAP.md) has the order I am doing things in and why.

## How it fits together

```
ICP file ──► sources ──► discovery ──► research ──► scoring ──► sequence
              │                          │                        │
        GitHub, HN, job boards     cited dossier per         email / task / voice
        registries, filings        account and person        steps with guardrails
```

Each stage reads and writes plain typed records, so any stage can be rerun on its own from the previous stage's output.

## Getting started

You need Node 24 and pnpm.

```bash
pnpm install
```

Check a profile before spending any requests on it:

```bash
pnpm outbound icp validate examples/icp.voice-support.yaml
```

Then run discovery:

```bash
pnpm outbound discover examples/icp.voice-support.yaml --max 10
```

That prints a ranked list where every line of evidence has the URL it came from:

```
1. Pylon (usepylon.com)  [yc, ashby, ~120 people]
   description The Agentic Support Platform purpose-built for B2B. (YC Winter 2023)  {customer support}
               https://www.ycombinator.com/companies/pylon-2
   hiring      26 open, 1 matching role
               https://jobs.ashbyhq.com/pylon
   hiring      Hiring: Lead Product Manager, Customer Experience (NYC or Palo Alto (in office))  {customer experience}
               https://jobs.ashbyhq.com/pylon/22e70a73-03ee-464c-8007-202c7f80cabe
```

The words in braces are the ICP terms that line matched.
Add `--json` to get the same report as JSON on stdout, or `--out report.json` to write it to a file.
Progress goes to stderr, so piping stdout is safe.

Responses are cached under `.outbound/cache`, so rerunning while you tune a profile does not hit the APIs again.
Pass `--no-cache` to force fresh requests.

### Sources

```bash
pnpm outbound sources
```

| Source                         | Role       | What it tells us                                                      |
| ------------------------------ | ---------- | --------------------------------------------------------------------- |
| `yc`                           | discovery  | Who the company says it is, size, whether it is hiring                |
| `hackernews`                   | discovery  | Posts in the monthly Who is hiring thread, in the company's own words |
| `greenhouse`, `lever`, `ashby` | enrichment | Open roles, filtered to the ones the ICP cares about                  |
| `github`                       | enrichment | What the company's public org has pushed to in the last 90 days       |

None of them need a key.
`GITHUB_TOKEN` is optional and only raises GitHub's rate limit from 60 to 5,000 requests an hour.
Set `OUTBOUND_USER_AGENT` to identify yourself to the APIs you call.

Discovery sources start from the ICP and find companies.
Enrichment sources start from a company and find more about it.
A source that fails is reported at the end of the run and never stops the others.

### Writing an ICP

[examples/icp.voice-support.yaml](examples/icp.voice-support.yaml) is a complete profile with comments.
The parts that drive discovery today are `company.keywords`, `company.techSignals`, `company.hiringSignals`, `company.employees`, `company.regions` and `exclusions`.
If you already know some accounts you want, list them under `seeds` with their job board or GitHub slugs and they skip straight to enrichment.

Unknown keys are rejected, so a typo is an error and not a criterion that silently does nothing.

### Checks

```bash
pnpm check
```

`pnpm check` runs formatting, lint, typecheck and the test suite.
It is the same thing CI runs.
The tests never touch the network: every source is tested against a stubbed fetch.
The code layout and the reasoning behind it are in [docs/architecture.md](docs/architecture.md).

## Ground rules

A pipeline that contacts people needs rules that are not optional.

- Only public data, fetched through documented endpoints, inside their rate limits.
- Every claim in a dossier keeps a link to where it came from.
- Nothing is sent and no call is placed unless a run is explicitly started in live mode. Dry run is the default.
- Opt-outs and do-not-contact lists are checked before every step, not just the first one.

## Development

Work happens on a branch and goes through a push gate before it reaches the remote:

```bash
git push no-mistakes my-branch
```

The gate is [no-mistakes](https://github.com/kunchenguid/no-mistakes).
It reviews the diff, runs the checks in a clean worktree and only then forwards the branch.
Its config is in [.no-mistakes.yaml](.no-mistakes.yaml).

## License

MIT

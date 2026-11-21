# outbound

An outbound engagement pipeline I am building in the open.

You give it an ideal customer profile.
It goes and finds companies that fit, works out who to talk to and what they are building right now, and then runs a multi-step sequence where the phone call is handled by a voice agent rather than a person reading a script.

The voice side is deliberately modelled on how Sierra describes its own platform: declarative journeys, supervisors that watch the agent rather than a single giant prompt, a cascaded speech pipeline, and simulations that gate every release.
I want to understand that design by building a small version of it end to end, on a problem where I can tell whether it works.

## Where it is today

This is early.
The honest status of each stage:

| Stage     | What it does                                            | Status      |
| --------- | ------------------------------------------------------- | ----------- |
| ICP       | Parse and validate an ideal customer profile            | in progress |
| Sources   | Pull company and people signals from public APIs        | in progress |
| Discovery | Fan out over sources, dedupe, merge into prospects      | in progress |
| Research  | Per-prospect research agents that build a cited dossier | planned     |
| Scoring   | Rank prospects by fit and by why-now                    | planned     |
| Sequence  | Multi-step, multi-channel outreach with stop conditions | planned     |
| Voice     | Journeys, supervisors, cascaded STT to LLM to TTS       | planned     |
| Sims      | Simulated callers and pass^k reliability gates          | planned     |

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

```bash
pnpm check
```

`pnpm check` runs formatting, lint, typecheck and the test suite.
It is the same thing CI runs.

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

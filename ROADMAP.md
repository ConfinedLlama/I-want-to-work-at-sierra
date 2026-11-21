# Roadmap

The order here is the order I am building in.
Each milestone should leave the pipeline runnable end to end up to that stage, with tests, before the next one starts.

## 1. ICP and discovery

- [x] ICP schema: firmographics, tech signals, personas, exclusions, the offer.
- [x] Load an ICP from YAML or JSON with useful error messages.
- [x] HTTP client shared by every source: timeout, retry with backoff, per-host rate limit, on-disk cache.
- [x] Source interface and registry.
- [x] Sources that need no key: Hacker News, GitHub, Greenhouse, Lever, Ashby, YC directory.
- [x] Discovery: fan out, dedupe by domain, merge signals into one prospect record.
- [x] CLI: `outbound icp validate`, `outbound sources`, `outbound discover`.

Known gaps, found by running it against live data:

- [ ] A guessed job board slug is not verified. `acme` on Greenhouse could be a different Acme. GitHub already checks the org's website against the domain, and the boards need an equivalent.
- [ ] Hacker News posts carry no structured location, so the ICP's regions are not applied to them.
- [ ] Ties in the pre-enrichment ranking fall back to alphabetical order, which decides who makes the cut when `--max` is small.
- [ ] Without a token GitHub allows about 30 companies an hour. The report should say when enrichment stopped early for that reason.

## 2. Research

- [ ] Evidence model: every fact carries a source URL and a fetched-at time.
- [ ] Research planner that turns a prospect plus the ICP into concrete questions.
- [ ] Research agents: company, people, what-they-are-building, why-now.
- [ ] Model provider interface with a deterministic offline provider for tests.
- [ ] Dossier output with citations, and a check that rejects uncited claims.
- [ ] More sources: npm and PyPI, SEC EDGAR, GDELT news, company blogs over RSS.

## 3. Scoring

- [ ] Fit score against the ICP with a per-criterion breakdown.
- [ ] Why-now score from recent signals such as hiring, launches and funding.
- [ ] Persona matching to pick who to contact at each account.

## 4. Sequence

- [ ] Sequence definition: ordered steps, waits, branches on outcome.
- [ ] Step types: email draft, manual task, voice call.
- [ ] State machine per prospect with a durable event log.
- [ ] Suppression: opt-outs, do-not-contact, already in progress, quiet hours by timezone.
- [ ] Dry run by default, live mode behind an explicit flag.

## 5. Voice agent

- [ ] Journeys: goals and steps declared as data, not buried in a prompt.
- [ ] Tools the agent can call, with typed inputs and outputs.
- [ ] Supervisors on input and output, and a deterministic sensitive-data guard.
- [ ] Cascaded pipeline behind interfaces: turn detection, STT, reasoning, TTS.
- [ ] Outbound specifics: pickup detection, voicemail, wrong person, callback scheduling.
- [ ] Latency accounting per turn, measured as time to first audio.

## 6. Simulation and evaluation

- [ ] Simulated callers with a persona, a goal and a patience level.
- [ ] Conversation tests graded on final state rather than on wording.
- [ ] pass^k reporting so a flaky agent cannot hide behind one good run.
- [ ] Sims wired into `pnpm check` as a release gate.

## 7. Operations

- [ ] SQLite store for prospects, dossiers and sequence state.
- [ ] Structured logs and a per-run report.
- [ ] Immutable release snapshots of journeys, prompts and model choices.

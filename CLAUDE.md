# Working in this repo

Context for anyone, human or agent, picking up work here.

## What this is

An outbound engagement pipeline: ICP in, researched prospects out, then a sequence whose call step is a voice agent.
[README.md](README.md) explains the product, [docs/architecture.md](docs/architecture.md) explains the code, and [ROADMAP.md](ROADMAP.md) is the ordered list of what to build next.

## Commands

- `pnpm check` runs format check, lint, typecheck and tests. It must pass before every commit.
- `pnpm format` fixes formatting.
- `pnpm outbound <command>` runs the CLI from source.
- `scripts/check.sh` is what the push gate and CI call. It switches to the Node version in `.nvmrc` when nvm is available.

Node 24 is required. If your shell is on another version, run `nvm use` first.

## How work is done here

- Pick the next unchecked item in ROADMAP.md, top to bottom. Known gaps listed under a milestone count as items.
- Small commits, each one thing, each passing `pnpm check`. Conventional commit subjects: `feat(scope):`, `fix(scope):`, `test:`, `docs:`, `chore:`, `refactor:`.
- The commit body says why, in plain sentences. No trailers of any kind.
- A bug fix starts with a test that fails for the reason the bug exists.
- Tick the roadmap item in the same branch that finishes it.
- Work on a branch and send it through the gate with `git push no-mistakes <branch>`, then fast-forward `main`.

## Code conventions

- Fallible calls return `Result` from `src/core/result.ts`. Do not throw for expected failures.
- No module below `src/cli` reads `process.env`, calls `Date.now()` or calls `fetch` directly. Take a `Clock` and an `HttpClient`.
- External JSON is parsed with a zod schema that lists only the fields we read, all optional fields `nullish`.
- Every `Signal` carries the URL it was observed at.
- Match ICP terms with `matchTerms`, never `includes`.
- Tests never touch the network. Use `StubFetch` and `FakeClock`.
- Comments explain why. Use a plain hyphen, never an em dash, in prose and comments.
- Markdown: one sentence per line.

## Rules for anything that contacts people

- Public data only, through documented endpoints, inside their rate limits.
- Dry run is the default. Sending or calling needs an explicit live flag.
- Opt-outs and do-not-contact lists are checked before every step.

---
name: daily-build
description: One day of work on the outbound pipeline - pick the next roadmap items, build them in small tested commits on a branch, send the branch through the push gate, and land it on main. Use when asked to do the daily build or to continue the roadmap.
---

# Daily build

One run of this playbook is one day of work.
It ends when the day's branch is on `main`, or when it hits something only the owner can decide.
It never loops and never starts a second day.

## Before anything else

1. Make sure the toolchain is right.
   `node -v` must be 24.
   If it is not, prefix commands with `export PATH="$HOME/.nvm/versions/node/v24.22.3/bin:$PATH"` or run `nvm use`.
2. Look at the state of the repo: `git status`, `git branch --show-current`, `git fetch origin`, `git log --oneline -15`.
3. Look at the gate: `no-mistakes axi`.
   If a run is active on a branch, finish driving it first with the `no-mistakes` skill before starting anything new.
   If a previous day's branch was validated but never landed on `main`, land it (see "Landing") before starting today's.
4. If the working tree has uncommitted changes you did not make, stop and report.
   Do not stash, reset or discard them.
5. Start from an up to date `main`: `git checkout main && git pull --ff-only`.
   Then `pnpm install --frozen-lockfile` and `pnpm check`.
   If `pnpm check` fails on a clean `main`, fixing that is the first job of the day.

## Choosing the work

Read `ROADMAP.md` top to bottom.
The day's work is the next unchecked items, in order, including the "Known gaps" under a milestone.
Take as much as makes one coherent branch: usually one milestone slice of four to eight items.
Do not skip ahead to a later milestone because it looks more interesting.

Name the branch for what it delivers, for example `feat/research-evidence` or `fix/board-slug-verification`.

When a milestone is finished and the next one needs facts you do not have (an API's response shape, how Sierra describes a concept), look them up from primary sources before writing code.
For the voice milestones the design follows what Sierra has published: declarative journeys, supervisors rather than one large prompt, a cascaded pipeline of turn detection, speech to text, reasoning and text to speech, time to first audio as the latency metric, and simulated callers scored with pass^k as the release gate.

## How to build

- Aim for roughly 20 to 30 commits in the day.
  That number comes from the work being cut small, never from padding.
  A commit that only exists to raise the count is worse than no commit.
- A healthy day has a mix: new behaviour, the tests that pin it, fixes for what a real run turned up, and the docs that changed because of it.
- Each commit is one change and passes `pnpm check` on its own.
  Run `pnpm check` before every commit.
- Tests go in the same commit as the code they test.
- A bug fix starts with a test that fails because of the bug.
- After the unit tests pass, run the real thing end to end, the way a user would: `pnpm outbound ...` against the live public APIs.
  Read the output critically.
  Anything that looks wrong is either fixed today, with a test, or written into `ROADMAP.md` as a known gap.
- Follow the code conventions in `CLAUDE.md`.
- Tick roadmap items in the branch that completes them.
  Update `README.md` and `docs/architecture.md` when what they describe has changed.
- New dependencies need a reason.
  Prefer the standard library and what is already installed.

## Commit rules

- Conventional subject under 72 characters: `feat(scope): ...`, `fix(scope): ...`, `test: ...`, `docs: ...`, `refactor: ...`, `chore: ...`.
- A body of one to three plain sentences saying why, when the why is not obvious from the subject.
- The owner is the only author.
  No trailers of any kind.
  Nothing in a commit message, comment or document refers to how the code was produced.
- Never amend or rebase commits that are already on `origin`.
  Never force-push.
  Never pass `--no-verify`.
  Commit dates are whatever the clock says.
- Never edit `CHANGELOG.md` or generated files by hand.
- Prose uses a plain hyphen, never an em dash.
  Markdown has one sentence per line.

## The gate

When the branch is done and `pnpm check` is green, validate it with the `no-mistakes` skill:

```bash
no-mistakes axi run --intent-file <file> --wait 9m
```

The intent says what the branch is for, the decisions made along the way, what is deliberately left out, and repeats the commit rules above so the gate's own fix commits follow them.

Review of a large branch takes a long time.
When a wait elapses, re-run the same command to reattach.
Do not edit files or commit while a run is active.

Findings:

- `auto-fix` and `no-op`: decide on your own judgment.
- `ask-user`: the owner has given standing instructions to decide these without stopping.
  Fix real defects.
  Keep features that are in the roadmap and fix the bugs found in them.
  Decline pure style preferences.
  When responding with `--action fix`, write instructions that say how each one should be fixed and that every fix needs a failing test first.
  List each decision in the day's summary so the owner can overrule it.
- `protected-path-refusal` and `test-agent-unvalidated-work`: stop and report.
  These need the owner.

If the run ends `failed`, read why, follow the `branch_sync` guidance, fix the cause on the same branch with a new commit, and run the gate once more.
If it fails a second time for the same reason, stop and report.

## Landing

The gate pushes the branch to `origin` once it passes.
`gh` is not logged in on this machine, so no pull request is opened.

1. Read `branch_sync` from `no-mistakes axi status` and run `no-mistakes axi sync` if it offers one, so the local branch has the gate's fix commits.
2. Run `pnpm install --frozen-lockfile && pnpm check` on the synced branch.
3. Check every commit on the branch: `git log main..HEAD --format='%an <%ae> | %s%n%b'`.
   There must be one author, no trailers, and nothing that mentions tooling.
   The gate names its own commits after its steps, for example `fix(review): ...` or `fix(push): apply agent fixes`.
   Those subjects must not reach `main`.
   Reword them locally to describe the change with a real scope, such as `fix(sources): ...` or `docs: ...`, without touching their content.
   Verify the tree is identical before and after with `git rev-parse HEAD^{tree}`.
4. `git checkout main && git merge --ff-only <branch> && git push origin main`.
5. Confirm with `git log origin/main --oneline -5`.
   Then delete the day's branch locally and on `origin`, since `main` now has everything on it.

## Stop conditions

Stop and report, without working around it, when:

- the working tree has changes that are not yours,
- `git push` or the gate is refused for a reason that is not about the code,
- a step would contact a person or company, send a message or place a call,
- a source would need credentials, scraping behind a login, or breaking a rate limit,
- the roadmap is finished.

## The summary

End with a short report: what was built, the number of commits that landed on `origin/main`, the gate outcome, each gate finding you decided and how, known gaps added to the roadmap, and anything waiting on the owner.

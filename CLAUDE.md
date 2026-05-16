# Working in this repo

Notes for an AI coding agent (Claude Code or similar) onboarding to this project. Read this first; it's the load-bearing context for almost every change you'll make.

If you're a human reading this for the AI-development-story angle, the meta-doc is [`docs/AI_DEVELOPMENT.md`](./docs/AI_DEVELOPMENT.md).

---

## What this project is

`wealthtrajectory` is a private, local-first wealth-planning app — Next.js + Zustand + TypeScript, 100% client-side computation, IndexedDB-persisted, optional Google Drive backup. The math is the asset; the UI is the shell. Engines under `lib/<subsystem>/` are pure functions tested to ≥ 90% line + branch coverage; UI components under `app/_components/<subsystem>/` are display-only.

See (the four founding docs, drafted before meaningful code and maintained as living documents):
- [`docs/PRD.md`](./docs/PRD.md) — what we're building + why (read §1, §6.5, §7)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — layering, store composition, extension points
- [`docs/ImplementationPlan.md`](./docs/ImplementationPlan.md) — tech stack, data model, build sequence
- [`docs/Calculations.md`](./docs/Calculations.md) — every formula the engines use
- [`docs/Glossary.md`](./docs/Glossary.md) — load-bearing terms (reference)

---

## Load-bearing patterns

### 1. Engine purity (`lib/`)

Engine modules MUST be pure functions of their inputs. **No** `Date.now()`, **no** `Math.random()`, **no** store reads, **no** I/O. NaN-safe at boundaries — bad input contributes 0, not NaN; let the math degrade gracefully rather than poison downstream accumulators.

Why: the engines are the asset. They have to be:
- Reproducible (a test should never see flaky output)
- Testable in isolation (no mocking required)
- Liftable into a CLI, worker, or server-side rendering pass without modification

If you find yourself wanting to import the store from `lib/`, that's a signal the function belongs in `app/_components/` or as a hook.

### 2. Store action setters produce fresh references

Zustand state lives in 16 slices under `lib/store/`. Every action's setter MUST shallow-copy the state slice it touches. **Never mutate in place.** Reason: `PersistenceHydrator` and `CloudSyncer` diff state by reference equality (`state.assumptions === prev.assumptions`); an in-place mutation produces the same reference, the diff says "no change," and the save / sync silently skips.

There are regression tests pinning this for the assumptions slice — extend them if you add a new field whose change-detection matters.

### 3. Rollup-include cascade

The `Member.includeInRollup` flag is the system's single switch for "include this member in household-aggregate views." When `false`, the member's per-member fields + their owned accounts + their owned liabilities + their owned budget items + their owned income streams all drop out of household totals.

The cascade is enforced by:
- `lib/types.ts:activeMembers` / `householdForRollups` / `activeMemberIds`
- `lib/budget/budget.ts:filterBudgetForRollups`
- `lib/budget/incomeStreams.ts:filterIncomeStreamsForRollups`
- `lib/projection/useActiveProjection.ts:resolveActiveProjection`

**If you add a new collection keyed by `ownerId`, it MUST cascade too.** `lib/rollupContract.test.ts` is the failure-driven checklist that catches new collections ignoring the flag — add an assertion there for every new collection. There's a dedicated skill: see `.claude/skills/adding-a-rollup-aware-collection/`.

### 4. Subsystem organization + import paths

`lib/` is organized by subsystem: `projection/`, `portfolio/`, `budget/`, `health/`, `tax/`, `sync/`, `persistence/`, `data/`, `insights/`, plus the existing `store/`. Cross-cutting core types (`types`, `format`, `nominal`, `entityIds`, `demo`, `store`, `useLocalStorageState`) stay at `lib/` root.

`app/_components/` follows the same shape: `ui/`, `shell/`, `infra/`, `projection/`, `allocation/`, `holdings/`, `plan/`, `insights/`, `data/`.

Import-path convention:
- **Same subsystem** → relative `./X`
- **Cross-subsystem** → absolute `@/lib/<sub>/X` or `@/app/_components/<sub>/X`
- **Tests** are co-located (`<module>.test.ts` sibling). Cross-cutting tests (`properties.test.ts`, `rollupContract.test.ts`, etc.) live at `lib/` root.

### 5. Test-driven on the math

Every engine module has a sibling `*.test.ts` pinning input → output contracts. For math layers, there's also `lib/properties.test.ts` (fast-check property invariants spanning multiple engines) and `lib/rollupContract.test.ts` (cross-feature integration contract).

Workflow on engine changes:
```
1. Open lib/<engine>.test.ts
2. Write the test for the behavior you want. Run it. Watch it FAIL.
3. Make the smallest change to lib/<engine>.ts that turns it green.
4. Run the full suite. Refactor if needed; keep it green.
5. Commit the test + implementation together.
```

If you can't write the failing test first, you don't understand the change well enough yet.

---

## What to never do

- **Modify engine code without tests.** Even a "trivial" bug fix gets a regression test in the same commit.
- **Mutate Zustand state in place.** Always shallow-copy via spread or array methods that return new arrays.
- **Sprinkle null-checks for impossible cases.** Trust internal code; validate at system boundaries (user input, API responses).
- **Add `as never` / `as any` to make tests compile.** Build a proper fixture instead — type errors in test code are catching a real signal.
- **Default to creating new helper files.** Three similar lines is better than a premature abstraction. If a pattern emerges across three call sites, extract then.
- **Run `npx eslint --fix` across the whole codebase.** It produces sprawling diffs that obscure the actual change. Run on files you touched only.
- **Commit without running `npm run verify`.** That's `tsc + lint + test + build` in one command — the same chain CI runs. Catch it locally.
- **Skip the `npm run verify` chain after a refactor** — TypeScript's "looks correct in your editor" is not enough.

---

## How to find things

- **A formula** → `docs/Calculations.md` first, then the corresponding `lib/<subsystem>/<module>.ts`
- **A user-facing feature** → `docs/PRD.md` §7
- **A term's exact meaning** → `docs/Glossary.md`
- **An asset class extension** → `lib/portfolio/holdingKinds.ts` + see `.claude/skills/adding-an-asset-class/`
- **The shape of any slice** → `lib/store/<name>Slice.ts`
- **Why a specific design was chosen** → the load-bearing patterns above + the in-file doc comments (the codebase is generously commented on WHY, less on WHAT)
- **CI failure triage** → `.claude/skills/investigating-a-ci-failure/`
- **Regenerating README walkthroughs/demos** → `docs/Screenshots.md` (Playwright capture pattern; portable to other repos)

---

## How to use sub-agents on this codebase

The `Agent` tool has three `subagent_type` values that are genuinely useful here. **Important: the `team-lead` subagent works differently depending on whether your Claude Code build has the experimental agent-teams feature enabled — pick by mode.**

### One-shot sub-agents (universally available)

- **`Explore`** — fast read-only search. Use for "find every place that does X" or "what's the surface area of feature Y." Don't use for "implement X" — that's the main agent's job.
- **`Plan`** — design proposals. Use before implementing a feature that spans ≥3 subsystems to get an architecture sanity check.

These run once, return a single result, the main agent continues.

### Multi-phase work — pick by mode

The project ships a `team-lead` subagent definition (`.claude/agents/team-lead.md`) that recursively spawns `feature-builder` + `code-reviewer` subagents to handle multi-phase work. **Two operational modes**:

- **Hub-and-spoke (standard Claude Code, default)** — `Agent({ subagent_type: "team-lead", ... })` runs as a single deep sub-agent invocation. Team-lead decomposes internally, recursively spawns workers, returns ONE summary. Use for: a single user request that decomposes into 2-4 internal phases the user doesn't want to coordinate manually.

- **Persistent team (experimental agent-teams feature, opt-in)** — same `team-lead.md` definition, but the runtime makes the team-lead persist across user turns. The user can pause for input mid-stream, the team-lead can checkpoint, you can query its task list between turns. Use for: project-spanning coordination with check-ins across multiple sessions.

**Check which mode you have before promising the user "long-running" or "uninterrupted" sessions.** Hub-and-spoke runs DEEPLY but RETURNS ONCE — it doesn't span turns. Persistent team does.

See `.claude/skills/agent-team-orchestration/` for the full mode comparison + when to spin a team up at all.

### Default to in-conversation work

For a normal request — bug fix, single-file feature, doc update — just do it in the main thread. Don't reach for an agent (one-shot or team) just to look busy. The verification chain (`tsc + lint + test`) is fast enough that thoroughness doesn't require delegation.

---

## Verification chain (run before every commit)

```bash
npx tsc --noEmit         # type check
npm run lint             # eslint
npm test                 # full Vitest suite (1100+ tests)
npm run build            # production Next.js build
```

Or as one shot: `npm run verify`.

When a test fails, fix the **root cause** — don't bypass with `--no-verify` or by deleting the test. The exception: if you're regenerating a visual baseline because copy intentionally changed, update the snapshot and commit it. See the CI-failure skill for the triage pattern.

---

## When in doubt

- Mirror an existing similar feature's structure. The codebase is internally consistent; the right answer is usually "do it the same way `X` did."
- If you can't find a similar feature, your change might be introducing a new concept — surface that to the user and confirm before building.
- If a test breaks and you don't understand why, STOP. Don't "fix" it by deleting the assertion. The test was catching something; figure out what.

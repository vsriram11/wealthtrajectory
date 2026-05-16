# Contributing

Thanks for the interest. This is a small, opinionated codebase; a
few conventions make the difference between a PR that lands in a
day and one that drifts. Read this once, then refer to
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the bigger
picture.

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # full suite: engine + slice + component + property-based
npm run test:watch     # interactive — re-runs on file save
npm run test:coverage  # vitest with v8 coverage report
npm run verify         # typecheck + lint + test + build (what CI runs)
```

Node ≥ 20, npm 10+. No global tools required.

## Using Claude Code with this repo

This repository ships first-class support for [Claude Code](https://claude.com/claude-code) (Anthropic's CLI coding agent). If you use it, the workflow is roughly:

1. **Open the repo in Claude Code.** [`CLAUDE.md`](./CLAUDE.md) loads automatically and provides the load-bearing context (engine purity, store-reference invariants, rollup-cascade contract, subsystem layout, import conventions).
2. **Use the custom subagents when warranted.** Three project-scoped subagent definitions live in [`.claude/agents/`](./.claude/agents/):
   - `team-lead` — coordinator for long multi-phase builds
   - `code-reviewer` — read-only review of staged changes
   - `feature-builder` — focused implementation of a single bounded phase
   Spawn via the standard `Task` / `Agent` tool with `subagent_type: "team-lead"` etc.
3. **Reach for a skill when a domain task pattern matches.** Four skills in [`.claude/skills/`](./.claude/skills/):
   - `adding-an-asset-class` — extending the holding taxonomy
   - `adding-a-rollup-aware-collection` — adding owner-keyed collections that must respect the include-in-rollup flag
   - `investigating-a-ci-failure` — webhook-driven triage playbook
   - `agent-team-orchestration` — when (and when NOT) to spin up an agent team
   - `capturing-readme-walkthroughs` — regenerate the README's animated walkthroughs / add a per-feature demo via the Playwright capture pipeline
4. **Follow the established discipline.** Test-driven on engine changes (write the failing test first); small commits with thorough messages; run `npm run verify` before push; never bypass with `--no-verify`. The patterns are documented in [`CLAUDE.md`](./CLAUDE.md) + the "Pattern catalog" section below.

The full story of how the codebase was built with Claude Code — workflow patterns, agent-team orchestration, self-healing CI loop, hallucination defense, the spec-first / TDD discipline — is in [`docs/AI_DEVELOPMENT.md`](./docs/AI_DEVELOPMENT.md). Read it if you're curious about the AI tooling story; not required for contributing.

The README's animated walkthroughs and per-feature demos are produced by a Playwright pipeline documented in [`docs/Screenshots.md`](./docs/Screenshots.md). When you change a feature surface in a way that drifts the captures, re-run `npm run screenshots:videos` and commit the regenerated assets in the same PR — same discipline as updating a test snapshot.

If you use a different agent (Cursor, Cline, GitHub Copilot Workspace, etc.), `CLAUDE.md` and the docs in `docs/` are tool-agnostic — they describe the codebase's conventions, not Claude-specific magic. The subagent + skill definitions are Claude Code-specific but easy to translate (the patterns themselves apply to any agent system).

## The contract

Three rules cover most of the code review:

1. **Engines are pure.** Anything under `lib/*.ts` (outside the
   `store/` directory) must be a pure function of its inputs. No
   `Date.now()`, no `Math.random()`, no store reads. The math is
   the asset — it has to be reproducible, testable in isolation,
   and liftable into a CLI / worker without modification.

2. **State lives in slices.** Never add a field to `AppState`
   directly. Pick the right `lib/store/<name>Slice.ts` (or create
   a new one). Each slice owns its state + actions and declares
   only the structural context it touches — no `AppState` imports
   inside slice files.

3. **Tests come first on engine changes.** This codebase is
   test-driven on the math. The loop:

   ```
   1. Open lib/<engine>.test.ts
   2. Write the test for the behavior you want. Run it. Watch it fail.
   3. Make the smallest change to lib/<engine>.ts that turns it green.
   4. Run the full suite. Refactor if needed; keep it green.
   5. Commit the test + implementation together.
   ```

   The math is the asset, and the tests are the spec. If you
   can't write the failing test first, you don't understand the
   change well enough to make it. The full philosophy + quality
   bar lives in [`docs/Testing.md`](./docs/Testing.md).

## Pattern catalog

When in doubt, find the closest existing example:

| You're adding… | Look at | Then do |
|---|---|---|
| A new asset class | `lib/holdingKinds.ts` | Add to `HOLDING_KIND_META`, then `lib/holdingFactory.ts` (builder), then a creator-form component. Display labels + defaults flow automatically. |
| A new piece of state | `lib/store/uiSlice.ts` | Pick the right slice or create `lib/store/<name>Slice.ts` with the canonical 5 exports + a `*Slice.test.ts`. |
| A new chart | `app/_components/ProjectionChart.tsx` | Derive from `computePortfolio()` or `projectIndependence()`. Engines own the math; the chart is presentation. |
| A new modal / editor | `app/_components/holding-editors/` | Set its `editingXId` field on the Editing slice; subscribe via `useAppStore((s) => s.editingXId)`. |
| A new engine | `lib/independence.ts` + `lib/independence.test.ts` | Pure function over `Household` + `Assumptions`. Test pins inputs → outputs. |

## Commits

- Conventional-style prefixes when they fit: `fix(ui): …`,
  `feat(engine): …`, `docs: …`, `test: …`, `oss: …` (for OSS
  prep / cleanup).
- Subject ≤ 70 chars; body explains the **why**, not the what.
- Reference the slice / engine / file by name in the body when
  it'd help a future bisect.

## Coverage + Codecov

Coverage runs in CI via `npm test -- --coverage`. The
`codecov/codecov-action@v5` step in `.github/workflows/ci.yml`
uploads `coverage/lcov.info` to [Codecov](https://codecov.io).
Configuration lives in [`codecov.yml`](./codecov.yml) — PR
comment layout, ignore paths, and the (informational, not
gating) coverage status checks.

### Activating Codecov on a fork / new repo

If you've cloned this and the Codecov badge in the README is
stuck on `unknown` or PR comments aren't appearing, three
boxes must be ticked. `codecov-action@v5` was a breaking
change from v4: **a token is required even for public repos**,
and silently no-ops without one — `continue-on-error: true`
in the workflow means a missing token doesn't fail the build.

1. **Activate the repo at <https://app.codecov.io>.** Sign in
   with GitHub, click *Add new repository*, pick the repo. This
   creates the Codecov-side record that uploads attach to.
2. **Install the Codecov GitHub App** —
   <https://github.com/apps/codecov> → *Install* → pick the
   repo. Without this, Codecov can't post PR comments (it lacks
   the GitHub API permission).
3. **Set `CODECOV_TOKEN` as a repo secret.** Settings →
   Secrets and variables → Actions → *New repository secret*.
   The token is shown on the repo's Codecov settings page after
   step 1.

After all three: push any commit, watch the workflow's *Upload
coverage to Codecov* step, and within a few minutes the badge
goes live + the PR gets a coverage comment.

There's no coverage gate — but if you delete tests, you'll see
the number drop on the PR. Don't.

## Pre-commit hook

A Husky pre-commit hook runs `tsc --noEmit` + `eslint` on staged
files. If you need to bypass it (rare — almost always a sign you
should fix the failure instead), `git commit --no-verify`.

## What I'll push back on in review

- New state on `AppState` instead of in a slice.
- Engine code that reaches into the store or browser globals.
- New asset-class branches scattered across `if (kind === "…")`
  instead of via the holding registry.
- "Drive-by" refactors stapled onto a feature PR — keep the diff
  scoped so review can actually finish.
- A new chart that recomputes math the engines already expose.

## What I'd love a PR for

- Engine bugs with a failing test case (especially Monte Carlo
  edge cases — illiquid-only households, all-cash portfolios,
  zero-income households).
- Accessibility improvements on the modals + chart annotations.
- Additional historical-return datasets (with a citation +
  methodology doc).
- More property-based invariants beyond the 10 in
  `lib/properties.test.ts` — particularly around the tax-bucket
  drawdown sequencer and the multi-asset wrapper composition.

## Contributor License Agreement (CLA)

By submitting a contribution (code, documentation, design,
ideas, or other material) to this project, you agree that:

1. You retain copyright to your contributions.

2. You grant the project owner and maintainers a perpetual,
   worldwide, non-exclusive, irrevocable, sublicensable license
   to use, modify, distribute, relicense, commercialize, and
   incorporate your contributions into this project and any
   related projects under any license terms.

3. You represent that you have the legal right to submit the
   contribution.

4. Contributions are provided "as is" without warranty.

If you do not agree to these terms, please do not submit
contributions.

The project itself is currently distributed under
[PolyForm Noncommercial 1.0.0](./LICENSE) — see that file for
the terms users receive the project under.

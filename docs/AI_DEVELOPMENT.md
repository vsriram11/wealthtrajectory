# AI development journal

This is a candid log of how this codebase was built with Claude Code (Anthropic's CLI agent). It's not a tutorial. It's a record of the workflow, the choices made, the things that worked, and the things that didn't.

Why this exists: a meaningful chunk of this repo's value isn't the code — it's the *workflow*. Anyone can clone the codebase. Reproducing the pattern of decisions, scaffolding, and review that produced it is the harder thing. This doc tries to make that visible.

The journal is intentionally first-person — when a writer mentions "I" or "we" they mean "the human plus the agent," collaborating in a fixed direction (human steers + reviews; agent proposes + implements + tests; both iterate).

---

## TL;DR (60 seconds)

- **Spec-first, not vibes-first.** Four founding docs — the PRD, Architecture doc, Implementation Plan, and Calculations reference — were written BEFORE meaningful code, then maintained as living documents. They were the seed context Claude needed to build coherently across hundreds of sessions.
- **Test-driven on the math.** Every engine module's test file was the spec. **1158 tests as of this writing** (snapshot — phrasing elsewhere in the docs uses `1100+` to stay durable as the suite grows). Includes a property-based layer (`lib/properties.test.ts`, 23 fast-check invariants) and a cross-feature integration contract (`lib/rollupContract.test.ts`).
- **Agent delegation by shape, not by reflex.** Read-only audits → `Explore`. Design proposals → `Plan`. Long multi-phase builds → custom `team-lead` subagent (defined in `.claude/agents/team-lead.md`). Most single-file work → main agent in conversation. No agent-for-agent's-sake.
- **Self-healing CI loop in practice.** When a PR webhook fires with a failure, the agent triages → proposes the fix → pushes → next webhook arrives. We ran this loop ~12 times on this branch — React Compiler memoization warnings, Lighthouse LCP thresholds, visual-snapshot dimension drift, and the usual long tail.
- **Hallucination defense = TSC + tests as ground truth.** Agent proposes; compiler and tests verify. Never trust agent "it should work" — always run the chain.

---

## The workflow we actually used

### Phase 0 — Spec-first, before writing meaningful code

The PRD (`docs/PRD.md`), Architecture doc (`docs/ARCHITECTURE.md`), Implementation Plan (`docs/ImplementationPlan.md`), and Calculations reference (`docs/Calculations.md`) were drafted FIRST. Then the codebase was seeded against them.

**Why this matters for AI tooling specifically:** an LLM agent is a context-windowing machine. The quality of its output is bounded by the quality of what's in the window. If you start coding without a spec, every session has to re-derive the product mental model from a hundred component files — incoherence creeps in fast.

With the spec docs in place:
- `CLAUDE.md` loads on every session and points at them
- The agent reads PRD §7 before adding a feature → understands the intent
- The agent reads Calculations §4 before changing a formula → understands the contract
- The agent reads ARCHITECTURE.md before adding a slice → understands the conventions

The docs aren't static. They're updated in the SAME commit as the code they describe. When the OSS philosophy shifted away from a paid tier, PRD §8 got rewritten in the same pass. When the income-streams feature shipped, Glossary + Calculations gained the relevant sections in the same PR. **Living docs.** Stale docs are worse than no docs because they erode the agent's trust in them.

### Phase 1 — Test-driven on the math

Every engine module under `lib/` has a sibling `*.test.ts`. The discipline:

1. Open `lib/<engine>.test.ts`
2. Write the test for the behavior you want
3. Run it; watch it FAIL
4. Make the smallest change to `lib/<engine>.ts` that turns it green
5. Run the full suite; refactor if needed
6. Commit test + implementation together

The agent followed this loop for ~every engine change. The visible effect: the math is the only part of the codebase that has near-zero churn — once a formula is pinned by tests, nobody rewrites it accidentally.

Two layers of test discipline beyond example-based unit tests:

**Property-based** (`lib/properties.test.ts`): fast-check generates inputs across the planner's domain; the test asserts a LAW holds for every input. Example: "income offsets are monotonic in survival rate" — adding more positive cash flow can never reduce Monte Carlo success %. Property tests catch regressions that example-based tests miss because the author never thought of that input.

**Cross-feature contract** (`lib/rollupContract.test.ts`): exercises the FULL CASCADE for the include-in-rollup flag through the live store — NW + income + projection + budget all drop in lockstep when a member is excluded. This is the test you point a new contributor at when they ask "how do I know I haven't broken the architecture?"

### Phase 2 — Implementation with discipline

A few patterns that recurred:

**Small commits during development.** Every shipped change was a focused commit with a thorough message explaining the WHY, not the WHAT. The granularity made each change reviewable in isolation and made it cheap to revert a single misstep without unwinding adjacent work. (The OSS repo ships as a single squashed commit; the small-commit discipline was a development-time investment, not an artifact you'll find in the public history.)

**Code that explains WHY, not WHAT.** Comments are scarce by default. When they exist, they explain rationale — "the `!== false` check is deliberate because…" or "this is the SINGLE composition point that cascades the include flag…" The agent was instructed (via `CLAUDE.md` and prompt guidance) to delete WHAT-comments and write WHY-comments only.

**Surface design tradeoffs explicitly.** When a decision had a real downside (rollup-include v1 was scoped wrong; we shipped it, the user pushed back, we re-shipped v2), the commit message acknowledges the v1 mistake. Pretending the first cut was always right erodes credibility.

### Phase 3 — Agentic review (the new step)

Before the main agent commits, a `code-reviewer` subagent reviews the staged changes. It's read-only — finds bugs, missing edge cases, contract violations — and returns a markdown table. The main agent addresses BLOCK + WARN findings before pushing.

This is the step most teams skip when they bolt AI onto an existing workflow. It catches what self-review misses (a single agent reviewing its own output has a known bias; an independent reviewer subagent doesn't).

Defined in `.claude/agents/code-reviewer.md`. Spawned automatically by the `team-lead` after each phase, or manually by the main agent on big diffs.

### Phase 4 — Human PR review (the irreducible step)

The agent doesn't ship without human sign-off. Every code change in this codebase was authored by Claude but reviewed + approved by a human reading the diff. This is non-negotiable.

The agentic review doesn't replace human review; it makes human review HIGHER-VALUE. The human reads a smaller, cleaner diff with the agentic reviewer's findings already addressed.

---

## Context management strategy

### `CLAUDE.md` as the entry point

Loads on every session. ~150 lines covering load-bearing patterns + the "never do this" list + how to find things + how to use subagents on this codebase. Tightly scoped to this project — not a generic LLM playbook.

### Subsystem folders as natural context boundaries

`lib/projection/` is self-contained. `lib/budget/` is self-contained. When an agent is working in one subsystem, the relevant files cluster — the agent doesn't need to scan 80 files to find the related ones. This is why we did the subsystem refactor (276 files moved via `git mv`, history preserved, all 1158 tests green throughout).

### Docs as referencable context

`docs/PRD.md` §7 is what the agent reads to understand intent. `docs/Calculations.md` §X is what it reads to understand a formula. `docs/Glossary.md` is what it reads when a term seems ambiguous. The docs are written for the agent as much as for humans — clear section numbers, file:line references in prose, real receipts.

### Sub-agents as context shields

A read-only audit run via `Explore` returns a 1500-word report, but the main agent only sees the report — not the 20+ file reads the Explore agent did. The main thread stays clean. We used this pattern repeatedly during doc audits (4 separate audit passes on this branch).

---

## Hallucination defense

The single most important rule: **the agent NEVER ships code based on "this should work."**

Three layers of verification before any commit:

1. `npx tsc --noEmit` — type-checks the change against the real code. Catches any wrong import path, any type mismatch, any structural error.
2. `npm test` — runs the full suite. The math invariants + the rollup contract + the property-based layer catch logic regressions.
3. `npm run lint` — catches React-Compiler-incompatible patterns, unused imports, code smells.

These chains are FAST (~20 seconds for full test suite). There's no excuse to skip them. The agent's job after writing code is to RUN the verification — if anything fails, fix the cause, re-run. Loop until green.

When the user asks "are you sure this works?" the agent says "yes, here's the chain output." Not "should be fine."

---

## Sub-agents vs agent teams (and the two team modes)

The Claude Code `Agent` tool spawns subagents. There are three flavors of value here, and the third flavor splits further into two MODES — the distinction matters because the modes give different user-facing capabilities. Get the mode right or your expectations will be off.

### Flavor 1 — One-shot sub-agents (hub-and-spoke, universally available)

`Explore`, `Plan`, and any custom one-shot subagent. Pattern: spawn, prompt, run, return ONE result, parent continues. Useful for:
- Read-only audits (`Explore`) — the agent reads 20 files; the parent only sees the 1500-word report
- Design proposals (`Plan`) — architecture sanity check before implementation
- Tightly-scoped code review (a one-off `code-reviewer` spawn on a diff)

The parent's context stays clean because all the file-reading happened in the subagent's context window.

### Flavor 2 — Coordinator subagent in standard Claude Code (the "hub-and-spoke team")

Same `Agent` tool, but you spawn the `team-lead` subagent (`.claude/agents/team-lead.md`). Inside its single run, the team-lead recursively spawns `feature-builder` + `code-reviewer` subagents to handle phases. It runs verification (`tsc`, `npm test`, lint) between phases via Bash. Returns ONE final summary.

This is **what you get out of the box in standard Claude Code today.** The team-lead runs DEEPLY (multiple internal spawns + verification cycles) but RETURNS ONCE — it doesn't span user turns. The user prompt → team-lead → final summary is still a single round-trip from the user's perspective.

What this is good for:
- A single user request that decomposes into 2-4 internal phases the user doesn't want to coordinate manually
- The team-lead handles internal delegation, the user sees a verified result
- The main agent's context stays clean; the team-lead absorbs the implementation noise in its own context window

What this is NOT:
- Long-running sessions that survive across multiple user prompts
- Pause-for-input mid-stream
- Cross-turn task-list persistence

### Flavor 3 — Persistent team in experimental agent-teams mode (opt-in)

If your Claude Code build has the experimental agent-teams feature enabled, the SAME `team-lead.md` definition operates differently: the team-lead becomes a persistent entity across multiple user turns. The user can pause for input mid-stream, the team-lead can checkpoint, the user can query the task list between turns without restarting the workflow.

**This is the mode that delivers "long-running uninterrupted sessions with a team-lead keeping a timer + task list, coordinating work, minimizing implementation done by the team-lead itself."** Pattern most useful when the work spans multiple sessions or the user wants to dip in occasionally to redirect.

Currently experimental — not in all Claude Code builds. Forward-compatible: the `.claude/agents/team-lead.md` definition is the same either way; the feature flag determines the user-facing interaction shape.

### Which flavor when

| Situation | Use |
|---|---|
| Find every place that does X | Flavor 1 — `Explore` |
| Design proposal before implementing | Flavor 1 — `Plan` |
| Single bug fix or small feature | None — main agent in-conversation |
| Multi-phase feature within one user request | Flavor 2 — `team-lead` in hub-and-spoke mode (standard CC) |
| Project-spanning coordination across sessions | Flavor 3 — `team-lead` in persistent team mode (experimental CC) |

### Why a team beats flat sub-agent spam (in either Flavor 2 or 3)

Three properties hold in both team modes:
1. **State within the team-lead's run** — task list maintained internally as it orchestrates phases
2. **Phase-boundary verification** — the team-lead runs the test suite between phases, catching breakage early. Flat sub-agent spam from the main agent discovers breakage only at the end.
3. **Review as a structural step** — `code-reviewer` fires after every phase, not "if I remember." The team-lead workflow enforces it.

Flavor 3 additionally gives you cross-turn persistence; Flavor 2 doesn't.

### How we actually used this on this branch

Single-file fixes, small features, doc edits — main agent in conversation. The team-lead pattern (Flavors 2 and 3) was reserved for genuinely large work:
- The subsystem refactor (276 file moves across `lib/` and `app/_components/`, history-preserving)
- The income-streams feature build (data model → engine → MC integration → UI → tests; 5 phases)

For most of the work on this branch (small feature additions, CI fixes, doc audits) the main agent + occasional `Explore` audits was sufficient. The pattern's value scales with the size of the work — over-using teams is theater.

See `.claude/skills/agent-team-orchestration/` for the full trigger criteria + the two-mode comparison.

---

## Self-healing CI loop

GitHub Actions runs on every push. The repo is subscribed to PR activity events via Claude's GitHub MCP — when a check fails, a `<github-webhook-activity>` event arrives in the conversation. The agent:

1. **Acknowledges** the failure + classifies it (visual / lighthouse / test / build / etc.)
2. **Asks for the failing step's tail** if not already pasted
3. **Diagnoses + proposes** the fix in ONE message
4. **Pushes** the fix after user sign-off
5. **Waits** for the next webhook; if green, done. If failing again, re-investigate.

Concrete examples of fixes that went through this loop on this branch:
- React Compiler memoization warning after a subsystem refactor — patched the offending hook
- Lighthouse LCP threshold raised from 2500ms → 3000ms with rationale (CI runner ≠ real-user perf; documented `TODO(perf)` for the real fix)
- `/review` + `/security` visual snapshots switched to viewport-only after dimension drift between dev + CI rendering envs
- (~8 more in the same shape — small targeted fixes, each verified before push)

The triage playbook is codified in `.claude/skills/investigating-a-ci-failure/` so future agents inherit the pattern.

What this is NOT: a fully automated bot that auto-pushes fixes without human review. The human reads each diff before sign-off. The "self-healing" part is the DIAGNOSIS speed, not the autonomy.

---

## Marketing-capture pipeline (Playwright + ffmpeg + animated WebP)

The README's animated walkthroughs and per-feature interaction demos are produced by a small Playwright pipeline. Three spec files (`tour.spec.ts`, `demos.spec.ts`, `screenshots.spec.ts`), shared helpers, an ffmpeg post-process that converts the recorded WebM to animated WebP (the only widely-supported format that GitHub README renders inline without manual asset upload), one regenerate command (`npm run screenshots:videos`). Full architecture in [`docs/Screenshots.md`](./Screenshots.md); agent-facing playbook in [`.claude/skills/capturing-readme-walkthroughs/`](../.claude/skills/capturing-readme-walkthroughs/).

What this taught about AI-assisted visual work:

- **The agent cannot grade its own output.** I can verify a capture is the right size and has the right number of animated frames; I cannot tell whether the scroll *reads* smoothly or whether a drawer transition *lands*. The human becomes the visual quality gate. The right shape is: agent ships the infrastructure + a first pass; human watches the WebP twice and says "the home-page scroll gets stuck" or "the rollup demo doesn't show enough." Then iterate.
- **Iterate on pacing, not infrastructure.** Five rounds of "the drawer is too fast / the scroll is too jumpy / the gray space appears at the start / now they should be one long video, not six short ones" shipped without re-architecting the spec — just tightening `waitForTimeout` values, splitting fullPage screenshots out of the video-recording spec, encoding at lower fps for size. The infrastructure (two specs, helpers file, ffmpeg post-process) survived every iteration; only the parameters changed.
- **Document the pipeline as a skill, not a one-off.** Writing `.claude/skills/capturing-readme-walkthroughs/SKILL.md` next to the technical doc makes the pattern discoverable when a future AI session is asked "the home dashboard demo is stale, re-record it" — without that, the agent would have to re-derive the regenerate command + the pacing conventions every time.

The pipeline is portable. A different Next.js / SPA repo can adopt the same shape by copying the four files and adjusting the hydration signal + nav helper — adaptation recipe in [`docs/Screenshots.md`](./Screenshots.md).

---

## Workflow micro-patterns that helped

- **Plan before implementing.** For non-trivial changes, the agent states the design back to the user as a 5-10 line bullet plan, gets sign-off, then implements. Prevents wasted work.
- **One commit per logical change during development.** Even a "tiny" doc fix got its own commit if it wasn't adjacent to other work. Made bisecting cheap and review painless. (Squashed for the OSS release; the discipline was for the build process, not the published artifact.)
- **Verify visually for UI changes.** After a UI change, the agent spins up the dev server, drives Playwright through the relevant flow, captures screenshots, sends them to the user. Don't claim "the UI looks right" without visual evidence.
- **Trust but verify agent reports.** When the team-lead reports "phase 3 done, tests green," the user (or main agent) re-runs the test command to confirm. Not paranoia — discipline.
- **Acknowledge mistakes in commit messages.** When v2 fixes a v1 design mistake, the v2 commit explicitly says "v1 was wrong because…" Builds reader trust in the documented decisions.

---

## What we'd do next

These are the higher-effort capabilities we deliberately scoped OUT of this branch. They're documented here so the next iteration knows the trade.

### Custom MCP server exposing engine math as tools

An MCP server that exposes the engine functions (`runHistoricalSequences`, `projectIndependence`, `computePortfolio`, etc.) as agent-callable tools. An agent could then "run a projection for the demo household with these assumptions" without writing code — purely via tool calls. Genuinely interesting; would let a non-code user interact with the math via chat.

Effort: 4-8 hours to build, package, document, register. Not done because there's no current user (the human author already has the code in front of them).

### Automated CI-failure → Claude pipeline

A GitHub Action that, on CI failure, POSTs the failure context to a Claude API endpoint and opens a PR with the proposed fix. Webhook-driven, no human in the loop until PR review.

We've done the equivalent MANUALLY end-to-end (webhook fires → human pings Claude → fix → push) ~12 times on this branch. Automating it is a packaging exercise; the diagnostic playbook (`.claude/skills/investigating-a-ci-failure/`) is the harder part, and it's already in the repo.

Not done because (a) the manual loop is fast enough for this project's scale, (b) automating mid-loop human review adds risk without proportional benefit at single-developer cadence.

### Memory + retrieval system

A persistent memory layer that retains learnings across sessions (e.g. "when this user says 'staff-level,' they want extensive doc updates"). Some of this is implicit in `CLAUDE.md`; explicit memory would be richer.

Effort: depends on substrate. Skipped because the project is small enough that re-deriving context per session is fine.

### Visual-regression with docker-pinned rendering

Currently the visual specs are viewport-only because full-page snapshots drifted across rendering envs (the local dev render produced a different page height than CI's Playwright runner, causing pixel-perfect baselines to fail without any real UI change). A docker-pinned Playwright environment (or Percy / Chromatic integration) would let us reliably use full-page snapshots and catch below-the-fold regressions.

Effort: 2-4 hours to set up + a recurring SaaS cost (Percy) OR self-hosted docker (free but maintenance burden). Skipped because the no-recurring-cost design principle (see `docs/OAUTH_VERIFICATION.md`) rules out the SaaS path.

---

## What didn't work / lessons learned

- **Over-decomposition into agent-team phases.** Early on we'd spin up a team for 4-file features. The team-lead's overhead exceeded the actual work. Now: bias against teams; spin up only when the work genuinely won't fit a single context window.
- **Sed-driven import rewrites across the codebase.** Worked for the subsystem refactor, but the safety net is the TypeScript compiler — without `tsc --noEmit` catching every broken path iteratively, the sed approach would have shipped broken imports. Lesson: the compiler IS your verification; don't ship a refactor without running it.
- **Trusting visual baselines across rendering envs.** Hit this twice (home page, security page). Lesson: full-page snapshots in CI without docker-pinning is fragile; viewport-only is the honest contract.
- **First-cut feature scopes.** Multiple features (rollup-include v1, conditional haircut v1) shipped with TOO-NARROW scope and required v2 follow-ups. Lesson: when in doubt, ASK the user "should this also affect X?" before implementing the narrow version.
- **Test counts in docs.** Used to hardcode "870 tests across 72 files" in README and ARCHITECTURE.md. Went stale every commit. Now: durable phrasing ("1100+ tests across engine / slice / component / property-based layers") that survives growth.

---

## Related artifacts

- [`CLAUDE.md`](../CLAUDE.md) — entry-point context for any AI session on this repo
- [`.claude/agents/`](../.claude/agents/) — `team-lead`, `code-reviewer`, `feature-builder` subagent definitions
- [`.claude/skills/`](../.claude/skills/) — `adding-an-asset-class`, `adding-a-rollup-aware-collection`, `investigating-a-ci-failure`, `agent-team-orchestration`, `capturing-readme-walkthroughs`
- [`.claude/settings.json`](../.claude/settings.json) — permission allowlist + status line
- [`docs/PRD.md`](./PRD.md) — what we're building + why
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — layering + extension points
- [`docs/Calculations.md`](./Calculations.md) — formula reference
- [`docs/Testing.md`](./Testing.md) — test discipline + suite shape
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — for human contributors (also references this doc + the AI-tooling artifacts)

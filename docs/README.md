# Documentation

This folder is the source of truth for wealthtrajectory's product and
engineering reference material. When code, copy, or charts diverge from
what is documented here, update the docs in the same change.

## Contents

### Founding spec (written FIRST, then maintained as living docs)

These four were drafted before meaningful code, then iterated alongside the implementation. They're the seed context any new contributor (human or AI) should load first.

- **[PRD.md](./PRD.md)** — Product Requirements Document. Vision, target
  users, core problems, feature scope, and product principles.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Codebase layering, the
  Zustand-slice composition pattern, branded entity ids, per-kind
  dispatch via the holding registry, and where to start when adding
  a feature.
- **[ImplementationPlan.md](./ImplementationPlan.md)** — Technical
  architecture, tech stack, data model, and build sequence.
- **[Calculations.md](./Calculations.md)** — The math behind every
  projection, target, and reliability test (Independence projection, SWR,
  Gordon-growth corpus, leverage exposure, glide path, Monte Carlo,
  sensitivity).

### Reference + operational docs

- **[Glossary.md](./Glossary.md)** — Definitions of Independence, Independence date,
  SWR, CAGR, real vs nominal, leverage buckets, tax buckets, glide
  path, and other terms used across the app.
- **[Testing.md](./Testing.md)** — TDD loop, what each test suite
  guards, when to reach for property-based tests, and the quality bar
  a test must clear to land. The math is the asset; the tests are
  the spec.
- **[PrivacyAndSecurity.md](./PrivacyAndSecurity.md)** — Threat model,
  data-flow boundaries, end-to-end encryption design, and sync-safety
  guards.
- **[OAUTH_VERIFICATION.md](./OAUTH_VERIFICATION.md)** — The 100-user
  Google Drive sync cap, why we accept it, what the failure mode
  looks like at user 101+, and the recipe for verifying if we ever
  change our mind.
- **[Screenshots.md](./Screenshots.md)** — The Playwright capture
  pipeline behind the README's animated walkthroughs and per-feature
  demos. Pacing pattern, ffmpeg settings, format trade-offs (animated
  WebP vs GIF vs MP4 on GitHub), how to adapt to a different repo,
  how to write a new feature-demo spec. Portable to any Next.js / SPA
  project.

### Meta — how the codebase was built

- **[AI_DEVELOPMENT.md](./AI_DEVELOPMENT.md)** — Candid journal of the
  AI-assisted development workflow this codebase was built under
  (Claude Code + custom subagents + skills). Spec-first / TDD
  discipline; context management strategy; hallucination defense;
  sub-agents vs the two agent-team modes (hub-and-spoke vs
  experimental persistent team); self-healing CI loop; what didn't
  work + lessons learned; future-work directions (custom MCP,
  automated CI-fix pipeline, memory layer, docker-pinned visual
  regression).

## Reading Order

New contributors should start with the **founding spec** in order:
`PRD.md` (what + why) → `ARCHITECTURE.md` (how it's laid out) →
`ImplementationPlan.md` (the build sequence + tech-stack choices) →
`Calculations.md` (the math reference; skim, return to as needed).

Then the **reference** docs — `Glossary.md`, `Testing.md`,
`PrivacyAndSecurity.md`, `OAUTH_VERIFICATION.md` — read when you
touch the corresponding surface.

`AI_DEVELOPMENT.md` is optional for contributors but recommended if
you're curious about the AI-tooling workflow used to build this repo.

## Conventions

- Section numbering (e.g. PRD §7.1, Calculations §4.2) is referenced
  from commit messages and code comments — preserve it when restructuring.
- Use Markdown headings (`#`, `##`, `###`) rather than HTML so the files
  render correctly in GitHub, editors, and any future static-site
  generator.
- All rates and balances in product copy and docs are in **real
  (today's-dollar)** terms unless explicitly labeled nominal. See
  Calculations §1.

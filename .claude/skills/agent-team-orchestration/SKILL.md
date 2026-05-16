---
name: agent-team-orchestration
description: Use for multi-phase work that warrants a coordinator + independent review of each phase. The team-lead subagent decomposes the work, delegates implementation to feature-builder, gates each phase through code-reviewer, and verifies green at phase boundaries. Two operational modes — hub-and-spoke (standard Claude Code) and persistent team (experimental agent-teams feature) — pick by capability available; see below. Skip for single-file fixes or focused engine changes — main agent in-conversation is faster.
---

# Agent team orchestration

The `team-lead` subagent (`.claude/agents/team-lead.md`) coordinates multi-phase work. **It runs in one of two modes depending on what your Claude Code build supports.** Pick the right mode for your situation, and frame your expectations accordingly.

## Mode A — Hub-and-spoke (standard Claude Code, available everywhere today)

This is the mode you have unless you've explicitly opted into experimental features.

**How it works**: the main agent calls `Agent({ subagent_type: "team-lead", ... })` once. The team-lead runs as a single deep sub-agent invocation. Inside that one run, it:
1. Decomposes the work into phases
2. Recursively spawns `feature-builder` for each phase (uses the `Agent` tool from within its own run)
3. Spawns `code-reviewer` after each phase
4. Runs verification (`tsc`, `npm test`, lint) between phases via Bash
5. Returns ONE final summary to the main agent

**What you get**:
- Recursive delegation that the user doesn't have to coordinate manually
- Phase-boundary verification inside one deep call
- A clean final summary the main agent reports up to the user
- The main agent's context stays clean (the team-lead absorbs the implementation noise in its own context window)

**What you don't get**:
- Multi-turn persistence — the team-lead returns ONCE; it doesn't span multiple user prompts
- The ability to pause for user input mid-stream and resume
- Long-running sessions that survive across conversation turns

**This is enough for**: a single user request that decomposes into multiple internal phases. The user sends one prompt, the team-lead does the deep work, returns a verified result.

## Mode B — Persistent team (experimental agent-teams feature, opt-in)

If your Claude Code build has the experimental agent-teams feature enabled, the SAME `team-lead.md` definition operates differently: the team-lead becomes a persistent entity across multiple user turns. It can:

- Maintain task-list state across turns + checkpoint progress
- Pause for user input mid-stream, resume on follow-up
- Be queried about its current status without restarting the workflow
- Run truly long-uninterrupted sessions with the user dipping in occasionally

**Caveats**:
- Currently experimental — not available in all Claude Code builds
- Forward-compatible: the team-lead definition is the same; the FEATURE FLAG determines the mode
- Worth checking the Claude Code release notes / your build's capabilities before assuming this is available

**This is enough for**: project-spanning coordination where the user wants to delegate "build this whole feature across multiple sessions and check in with me as you go."

## Which mode to use when

| Situation | Mode |
|---|---|
| Single user request, 2-4 internal phases, want one verified summary back | **Hub-and-spoke** (Mode A) — sufficient + universally available |
| Multi-day feature build with checkpoints, want to pause/resume across sessions | **Persistent team** (Mode B) — required, opt into experimental |
| Single-file fix or focused engine change | **Neither** — main agent in-conversation is faster |
| Read-only audit ("find every place X happens") | **Neither** — use `Explore` subagent directly |
| Design proposal ("what would it take to add Y") | **Neither** — use `Plan` subagent directly |

## When to spawn the team

Spawn a team (in either mode) when ALL of:
- The work decomposes into 2+ phases with clear deliverables
- At least one phase produces enough code (~200+ lines) to warrant independent review
- The total work would take a single agent ≥30 minutes of focused turns

Don't spawn when:
- The change is a single bug fix or small feature
- The work is read-only (use `Explore`)
- The deliverable is a design proposal (use `Plan`)
- The request is exploratory — investigate first, decide if a team is worth spinning up

## The team's structure (both modes use this)

```
Main agent
└─ team-lead                    ← coordinator; tracks task list
   ├─ feature-builder           ← implements phase 1
   ├─ code-reviewer             ← reviews phase 1 (read-only)
   ├─ feature-builder           ← implements phase 2
   └─ code-reviewer             ← reviews phase 2 (read-only)
```

Agent definitions live at `.claude/agents/`. Their role contracts are identical in both modes; the FEATURE FLAG (experimental teams on/off) is what changes the user-facing interaction shape.

## How to spawn (both modes — same API)

From the main agent, after confirming the request is team-worthy:

```
Agent({
  description: "Coordinate <feature> build",
  subagent_type: "team-lead",
  prompt: "Build <feature>. Decompose into phases of your choosing,
           confirm the plan with the user before delegating, then run
           each phase through feature-builder + code-reviewer. Final
           verification: full test suite + typecheck + lint must be
           green before reporting back."
})
```

What happens next depends on the mode:
- **Hub-and-spoke**: team-lead runs deeply, returns one summary, main agent reports up
- **Persistent team**: team-lead persists, main agent may receive intermediate updates / questions across turns

## When to spawn a team

Spawn a team when ALL of:
- The work decomposes into 2+ phases with clear deliverables
- At least one phase produces enough code (~200+ lines) to warrant independent review
- The total work would take a single agent ≥30 minutes of focused turns

Don't spawn a team when:
- The change is a single bug fix or small feature (use the main agent)
- The work is read-only (use `Explore` directly, no team needed)
- The deliverable is a design proposal (use `Plan` directly)
- The request is exploratory ("what would it take to...") — use main + Explore for the investigation, then decide if a team is worth spinning up

## The team's structure

```
Main agent (you)
└─ team-lead subagent           ← coordinator; tracks task list
   ├─ feature-builder subagent  ← implements phase 1
   ├─ code-reviewer subagent    ← reviews phase 1 (read-only)
   ├─ feature-builder subagent  ← implements phase 2
   └─ code-reviewer subagent    ← reviews phase 2 (read-only)
```

Each agent definition is at `.claude/agents/<name>.md`. Read those files for the role contracts.

## How to spawn

From the main agent, after confirming the request is team-worthy:

```
Agent({
  description: "Coordinate <feature> build",
  subagent_type: "team-lead",
  prompt: "Build <feature>. Decompose into phases of your choosing,
           confirm the plan with the user before delegating, then run
           each phase through feature-builder + code-reviewer. Final
           verification: full test suite + typecheck + lint must be
           green before reporting back."
})
```

The team-lead handles its own delegation from there. You'll get one return value at the end summarizing what was built + verification output.

## Why a team is better than flat sub-agent spam (in both modes)

Three properties:

1. **State persistence within the team-lead's run.** Even in hub-and-spoke mode, the team-lead maintains its own task list across the phases it orchestrates internally. A flat collection of sub-agents spawned directly by the main agent has no shared memory between them.
2. **Phase-boundary verification.** The team-lead runs the test suite between phases, catching breakage before it cascades. Naive sub-agent spam discovers breakage only at the end.
3. **Review as a structural step.** The code-reviewer subagent is spawned by the team-lead on each phase's output, not "if I remember." The team-lead's workflow enforces it.

In **persistent team mode** you additionally get: cross-turn task-list survival, the ability to pause-and-resume the workflow, and intermediate user check-ins.

## Anti-patterns

- **Always-team mode.** Most requests don't warrant a team. Bias against spinning one up.
- **Over-decomposition.** Phases should be 30-60 minutes of work each, not 5. If you have 8 phases, the team-lead becomes the bottleneck.
- **Skipping the code-reviewer.** Cheap to spawn, catches real bugs. Skip only when the phase output is trivial.
- **Letting the team-lead implement.** If the team-lead is writing code, you should have used the main agent. Team-lead's value is coordination + verification, not implementation.
- **Forgetting to confirm the plan.** The team-lead should ALWAYS state the phase breakdown back to the user before delegating. Skipping this turns the team into a black box.

## Receipts from this codebase

The team-lead pattern was useful for:
- The `lib/` + `app/_components/` subsystem refactor (276 files, 4 phases: lib moves → lib import fixes → component moves → component import fixes → doc updates)
- The income-streams feature build (data model → engine → MC integration → UI → tests, 5 phases)

The team-lead pattern was NOT useful for:
- Single-bullet CI fixes (just fix it in-line)
- Most engine math changes (single agent + property tests is faster)
- Reviewing a PR (just spawn one code-reviewer; no coordination needed)

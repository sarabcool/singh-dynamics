# Singh Dynamics Website QC

## Status

**V0 decision: BUILD, with a narrow scope.**

This workstream belongs inside the existing Singh Dynamics repository. Do not create a separate repository unless a future implementation requires an independently deployable service with a genuinely separate lifecycle. The current evidence does not justify that split.

## Product scope

The validated product is **not** a broad AI visual-design or taste engine.

The defensible V0 is a **structural integrity and generator-artifact reviewer for AI-generated websites**. It should inspect code and rendered output, identify defects with specific and checkable root causes, and propose small reviewable patches.

Think closer to a specialized linter with visual awareness than an autonomous designer.

### High-confidence defect classes

Prioritize defects where a skeptical reviewer can verify the diagnosis quickly:

1. Framework or build artifacts that silently fail, such as Tailwind classes generated dynamically and therefore omitted by JIT compilation.
2. Fragile or broken external asset references, especially assets hot-linked from unrelated or abandoned repositories.
3. UI copy and behavior mismatches, such as differently labeled CTAs routing to the same state or handler.
4. Missing structural sections where the codebase already establishes the necessary navigation or product structure, such as a page with no footer.
5. Dead, duplicate, or superseded components that reveal the intended implementation and make a small corrective patch safer.
6. Broken-image and similar failure states that expose browser-default degradation instead of a controlled fallback.

Pure taste calls such as spacing, color hierarchy, asymmetry, or visual preference are lower confidence and should not be patched automatically unless there is additional concrete evidence in the code or product semantics.

## Validation evidence

The real-repo validation gate tested three public, non-trivial repositories locally:

- `theadicoder/any-premium` (PremiumHub)
- `GabrielScript/Neumann`
- `codingwithalina/ApplyPilot`

A fourth candidate, `macroprotocol/memelist`, was dropped because the pushed repository was missing its entire `src/` directory and could not be built.

All three working repositories were Vite + React + TypeScript + shadcn-ui + Tailwind and all carried `lovable-tagger`, so the tested evidence is **Lovable-family output**. ApplyPilot showed evidence of a Bolt.new to Lovable migration, but that does not count as independent Bolt-only validation.

Six patches were performed, two per repo. All six built cleanly, type-checked cleanly, and rendered without observed regressions. Interactive fixes were exercised in a browser rather than accepted from diffs alone.

Examples included:

- Replacing a Tailwind template-literal class that JIT could never compile and restoring the existing site brand token.
- Adding missing footers without inventing new product copy.
- Moving Neumann's developer attribution from the hero into a footer.
- Routing Neumann's Start and Login CTAs to distinct signup and signin states.
- Removing ApplyPilot dependencies on images hot-linked from a sibling repository.
- Adding a controlled image failure state for future broken external assets.

Two candidate issues were deliberately not patched because the evidence was not strong enough. This restraint is part of the product requirement, not a failure to find work.

## Hard limits from validation

### Multi-platform breadth is unverified

Do not claim this generalizes to standalone Bolt.new, v0, or Replit Agent output yet. All three successful validation repos trace to Lovable.

The next falsification pass must use at least one real, non-trivial **Bolt-only or v0-only** repository that is not a Lovable project merely mentioning another builder in its README or history.

The pass succeeds only if Singh Dynamics can find at least two or three similarly concrete defects and produce similarly surgical, defensible patches.

### Continuous monitoring is still a hypothesis

The validation observed one snapshot per repository. It did not directly prove that the same generator defects recur over time. Do not sell continuous monitoring as validated evidence until recurrence is actually observed across repeated generations or updates.

## Integration with Singh Dynamics

Keep this capability in the existing repository.

Recommended ownership:

- `docs/website-qc/` for product scope, validation evidence, decisions, and test protocol.
- `agent/` for the reviewer harness when implementation starts.
- `.github/workflows/` for repeatable review jobs when the manual workflow has been repeated enough to justify automation.
- Existing site-generation and preview infrastructure may be reused where it cleanly fits, but do not couple this workstream to Singh AR runtime or customer billing.

Do not create auth, billing, a dashboard, SaaS tenancy, or unrelated infrastructure for Website QC during this validation stage.

## Sequencing

The next step is **not** a broad product build.

1. Run the Bolt-only or v0-only falsification pass.
2. Record defects, rejected candidates, patches, build/type-check results, screenshots, and regressions.
3. If the result transfers, define the smallest local reviewer harness inside `agent/` that reproduces the proven manual workflow.
4. Automate only after the manual process is repeated enough to expose a stable pattern, consistent with the repository's existing sequencing rule.

## Review standard

A proposed Website QC patch should normally satisfy all of these:

- The root cause is concrete and inspectable.
- The visible or behavioral symptom is reproducible.
- The patch is small and local to the diagnosis.
- It does not invent copy, data, colors, or product semantics.
- It does not redesign unrelated parts of the page.
- Build and type-check pass after the patch.
- The affected page or interaction is re-rendered or exercised.
- Regressions are checked explicitly.
- Weak or taste-heavy candidates are allowed to be rejected with no patch.

The goal is not to maximize the number of changes. The goal is to maximize the percentage of proposed changes that a competent repo owner would merge after a short review.

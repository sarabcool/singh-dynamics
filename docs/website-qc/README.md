# Singh Dynamics Website QC

## Status

**V0 decision: BUILD, with a narrow scope. Cross-platform falsification pass (Bolt.new) complete: PROCEED TO V0 HARNESS.**

This workstream belongs inside the existing Singh Dynamics repository. Do not create a separate repository unless a future implementation requires an independently deployable service with a genuinely separate lifecycle. The current evidence does not justify that split.

See `FALSIFICATION-2026-08-12-bolt-huewave.md` for the full second-platform validation: repo, provenance proof, defects found, patches applied, build/type-check results, and the resulting decision. The summary is folded into this document below; the dated file is the full record.

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

### Second platform: Bolt.new (`dmenchaca/huewave`)

The cross-platform falsification pass this gate called for is complete. Tested `dmenchaca/huewave`, a real, non-trivial, live color palette generator (17 commits, working Supabase auth, deployed at huewave.co), with provenance verified from Bolt.new's own build artifacts (`.bolt/config.json`, `.bolt/prompt`), not README claims, and confirmed to carry zero Lovable dependency or history.

Four patches performed, all removals of confirmed dead or unreachable code: a full orphaned Firebase integration left over from an earlier generation, a same-directory `index.ts`/`index.tsx` collision where the dead file was silently winning module resolution and bypassing the app's own dialog-state registration, three smaller dead/duplicate files, and two compiler-flagged unreachable `switch` cases. All four built cleanly, type-checked cleanly, and were verified live in a headless browser. One dev-server cache artifact came up mid-verification and is reported in full in the dated file rather than smoothed over; it was not a real regression. One hypothesized live bug (the dialog-registration gap enabling the spacebar shortcut to fire while a dialog was open) was tested directly and did not reproduce, a second independent guard already covered it; recorded as a falsified hypothesis, not a suppressed one.

Full detail, including the rejected defect class (no fragile external images exist in this app) and the reasoning on what did and didn't transfer from the Lovable round, is in `FALSIFICATION-2026-08-12-bolt-huewave.md`.

## Hard limits from validation

### Multi-platform breadth: Lovable and Bolt.new verified, v0 and Replit Agent still open

Two independent builders (Lovable, Bolt.new) now have real-repo evidence behind the same review approach: checkable-root-cause defects found, small surgical patches applied, clean build and type-check, live behavioral verification, honest reporting of what didn't hold up. Do not yet claim this covers v0 or Replit Agent specifically; their output shapes (v0's default Next.js App Router, Replit Agent's typical full-stack-with-own-server model) differ enough from the Vite-SPA shape both Lovable and Bolt produced that the claim needs its own evidence, not an extrapolation from two data points that happen to share a build tool.

A future pass against v0-only or Replit-Agent-only output would extend breadth further but is not currently blocking the V0 harness decision below.

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

Steps 1 and 2 are done. The next step is **not** a broad product build.

1. ~~Run the Bolt-only or v0-only falsification pass.~~ Done 2026-08-12, see `FALSIFICATION-2026-08-12-bolt-huewave.md`. Result: transferred.
2. ~~Record defects, rejected candidates, patches, build/type-check results, screenshots, and regressions.~~ Done, same file.
3. **Current step.** Define the smallest local reviewer harness inside `agent/` that reproduces the proven manual workflow: locate a candidate repo, verify builder provenance from artifacts rather than claims, clone/install/build/render, find checkable-root-cause defects across the classes proven out in both validation passes, patch surgically, verify build/type-check/behavior, report honestly including rejected candidates and any falsified hypotheses. This is a harness that runs the same manual steps, not new product surface, no auth, billing, dashboard, SaaS tenancy, or continuous monitoring yet.
4. Automate only after the manual process is repeated enough to expose a stable pattern, consistent with the repository's existing sequencing rule. Two runs (three Lovable repos, one Bolt repo) is not yet ten repetitions of the actual decision (what to patch, what to reject); the harness in step 3 should still route each finding through human review before automation is considered.

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

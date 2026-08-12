# Cross-Platform Falsification Pass: Bolt.new (HueWave)

**Date:** 12 August 2026
**Prior status:** V0 decision was BUILD, narrow scope, with multi-platform breadth explicitly flagged unverified. All three prior validation repos traced to Lovable. This pass exists to test whether the same review approach transfers to a real, non-Lovable repo.

## 1. Repo tested and proof of builder provenance

**Repo:** `dmenchaca/huewave` ("HueWave"), an open source color palette generator with Supabase-backed auth and saved palettes, live at huewave.co.

**Provenance was verified with file-level evidence, not README claims:**

- `.bolt/config.json` is present and reads `{"template": "bolt-vite-react-ts"}`. This file is written by Bolt.new itself as part of its scaffold; it is not something a developer or another tool would add by hand.
- `.bolt/prompt` is present and contains Bolt.new's own default project system prompt verbatim ("For all designs I ask you to make, have them be beautiful, not cookie cutter... Use stock photos from unsplash where appropriate...").
- `package.json`'s `name` field is `vite-react-typescript-starter`, Bolt.new's default generated name for this exact template, consistent with the `.bolt/config.json` template id.
- The README links `https://bolt.new/~/github.com/dmenchaca/huewave` as the live edit link.
- `grep -ri lovable` across the entire repository (`*.json`, `*.md`, `*.ts`, `*.tsx`) returned zero matches. No `lovable-tagger` dependency. No Lovable project URL anywhere.

This satisfies the requirement: a real repo, not a tutorial stub (17 commits, working Supabase auth, a real deployed product), with Bolt.new provenance established from build artifacts the tool itself generated, and no Lovable involvement anywhere in its history or dependencies.

## 2. Problems detected

**Rejected candidate, stated explicitly:** the app has no hot-linked or fragile external image references at all (the Bolt.new default prompt tells the agent to hot-link Unsplash photos, which was the exact defect class that broke ApplyPilot in the prior gate). HueWave doesn't use photography, so this defect class does not apply here. Recorded as a clean rejection rather than forced into a finding.

**A. An orphaned Firebase integration, a full duplicate backend never removed.**
`src/lib/firebase.ts` plus the entire `src/lib/firebase/` directory (`auth.ts`, `collections.ts`, `index.ts`, `palettes.ts`, `users.ts`) implement a complete second authentication and data layer. Confirmed dead by grep: zero files anywhere in `src/` import from any of these paths. Confirmed unreachable even if imported: `firebase` is not listed in `package.json` dependencies at all, so any import would fail to resolve. The live, working backend is Supabase (`src/lib/supabase.ts`, wired into `App.tsx` via `useSupabaseAuthEffect`). Reads as an earlier Bolt.new generation that was later regenerated onto Supabase, with the old integration left in place rather than deleted.

**B. Two files with the same module name in the same directory, resolving to different behavior, `ui/dialog/index.ts` and `index.tsx`.**
Both existed side by side. `index.tsx` wires `Dialog.Root` to a custom `DialogRoot` wrapper that registers every open/close with a shared `useDialogState` zustand store. `index.ts` wires `Dialog.Root` directly to the raw Radix primitive, bypassing that registration entirely. Verified empirically, not assumed: curling the Vite dev server's transformed source for a real consumer (`AuthDialog.tsx`) showed the import resolving to `index.ts`, meaning every dialog in the running app (sign in, save palette, delete palette, account settings, password reset) was silently bypassing its own app's dialog-registration system, and the more complete `DialogRoot` implementation was 100% dead code.
Tested for a live symptom before assuming one: `useKeyboardShortcut.ts` reads `isAnyDialogOpen` from that same store to suppress the spacebar "generate new colors" shortcut while a dialog is open. Reproduced with a real dialog open and a real spacebar press in a headless browser. **The bug did not reproduce.** A second, independent guard in the same hook (`target.closest('[role="dialog"]')`) already blocks the shortcut whenever the focused element is inside dialog markup, which covers the practical case today. The finding stands as a real, confirmed code defect (duplicate same-name files, genuinely divergent behavior, one completely unreachable), just not as a currently-live user-facing bug. Recorded honestly as such rather than oversold.

**C. Smaller dead and unreachable code, same category, lower individual stakes.**
- `src/lib/hooks/useTheme.ts`, a second `useTheme` implementation with a different signature, unused; the real one is `src/hooks/useTheme.ts`, imported in three places.
- `src/lib/hooks/useAuth.ts`, an unused Supabase auth hook superseded by `src/hooks/useSupabaseAuthEffect.ts`, which is the one actually wired into `App.tsx`.
- `src/components/account/EmailVerificationDialog.tsx`, a stale duplicate of `src/components/account/dialogs/EmailVerificationDialog.tsx` (the one actually imported by `EmailSection.tsx`). The dead copy is also the worse version: it is missing `autoComplete="one-time-code"` on the OTP field and a loading state on its submit button, both present in the live sibling.
- `AuthDialog.tsx` contains two `switch` statements each with a duplicate `case 'forgot-password':` clause. JavaScript's switch always matches the first case, so the second block in each was unreachable. `vite build` flags this directly (`This case clause will never be evaluated because it duplicates an earlier case clause`), it is not a subjective read. No behavioral difference today since the first (correct, demo-mode-aware) branch always wins, but it is confusing, compiler-flagged, dead code.

## 3. Patches attempted

Four patches, all deletions or removals, no new code written, nothing invented.

1. Removed `src/lib/firebase.ts` and `src/lib/firebase/` in full (6 files).
2. Removed `src/components/ui/dialog/index.ts`, keeping `index.tsx` (the complete, `DialogRoot`-registered implementation) as the sole file Vite can resolve.
3. Removed `src/lib/hooks/useTheme.ts`, `src/lib/hooks/useAuth.ts`, and `src/components/account/EmailVerificationDialog.tsx`.
4. Removed the two unreachable `case 'forgot-password':` blocks in `AuthDialog.tsx`, leaving the single reachable, demo-mode-aware case in each switch.

No copy was invented. No new colors, data, or product semantics were added. Every change is a subtraction of code already proven unreachable or superseded, not new material.

## 4. Successful and rejected patches

All four succeeded. Zero rejected after being attempted. One candidate defect class (fragile external images) was rejected before any patch was attempted, because it doesn't exist in this codebase, stated in Section 2 rather than omitted.

## 5. Build and type-check results

- `npx tsc --noEmit`: clean, exit 0, both before finalizing which files to remove and after all four patches.
- `npm run build` (`vite build`): clean, exit 0. Before the fourth patch, the build succeeded but esbuild emitted two explicit warnings about the unreachable switch cases; after the fourth patch, the build is warning-free.

## 6. Regression count

Zero, with one caveat worth recording plainly. Mid-verification, the long-running Vite dev server served a stale, cached module graph after the `ui/dialog/index.ts` deletion and briefly rendered a blank page with a 404 for the just-deleted file. This was a dev-server HMR cache artifact, not a code defect: a full restart of the dev process (clearing `node_modules/.vite`) resolved it immediately, and the authoritative check, `vite build` from a cold process, was clean throughout with no equivalent failure. Recorded here because a stop that looked like a regression should not be quietly smoothed over; it wasn't one, but it deserved to be checked rather than assumed away.

After the clean restart, verified live in a headless browser:
- Full homepage renders with no console or page errors.
- Opening the sign-in dialog now visibly registers in the app's own dialog-state store (indirect confirmation: the `[role="dialog"]` element is present and the app's existing guards continue to behave correctly).
- Pressing spacebar while the dialog is open leaves the palette unchanged (correct, guarded).
- Closing the dialog and pressing spacebar again changes the palette (correct, shortcut re-enabled).
- Full-page before/after screenshots taken and attached.

## 7. Did the prior Lovable findings transfer

Partially, and the honest shape of the transfer matters more than a yes/no.

**What transferred as a category:** "dead, duplicate, or superseded components reveal the intended implementation" transferred directly and was the strongest finding here too, exactly as it was in PremiumHub's unused `ProductCard.tsx`. So did "prefer defects with a checkable root cause", every finding here has a fact a reviewer can verify in under a minute (grep for imports, check `package.json`, read a compiler warning).

**What did not transfer as a literal repeat:** the prior gate's most repeatable literal finding, missing footer sections, doesn't apply to HueWave's single-view tool layout, and the fragile-external-asset pattern (the single most Bolt-flavored defect class, since Bolt's own default prompt tells it to hot-link Unsplash photos) happened not to appear in this specific app because it has no photography. That absence is itself informative: it shows the review process finds what's actually there rather than pattern-matching onto expected defect types.

**New, not present in the Lovable round:** the `index.ts` / `index.tsx` same-directory collision is a defect shape that didn't come up in any of the three Lovable repos. It's plausible this is more likely in Bolt.new output specifically, since Bolt's iterative in-browser editing model (regenerate a file, keep iterating) may be more prone to leaving a stale sibling file than Lovable's GitHub-sync model, but one repo is not enough evidence to claim that as a platform pattern. Flagged as a hypothesis, not a conclusion.

## 8. Does Website QC now have enough evidence to generalize beyond Lovable

Cautiously, yes, for the specific claim under test, not for the broader one.

The narrow claim, that the review approach (find defects with checkable root causes, produce small surgical patches, verify with build and type-check and live behavior, reject weak candidates explicitly) works on real, unfamiliar, non-Lovable output, now has evidence from two independent builders (Lovable and Bolt.new) instead of one. Four patches here, all successful, clean build and type-check, zero real regressions, one honestly-reported near-miss (the dev-server cache confusion) and one honestly-falsified hypothesis (the spacebar bug that didn't reproduce). That is exactly the kind of result the falsification pass was designed to either produce or fail to produce, and it came out positive.

The broader claim, that this generalizes to v0 and Replit Agent specifically, is still unverified. This pass tested Bolt.new only. v0's output shape (Next.js App Router by default, different component conventions, different sync model via the Vercel-hosted v0 platform) and Replit Agent's (typically a full-stack app with its own server, different deploy model) are different enough from both Lovable's and Bolt's Vite-SPA-plus-Supabase shape that a claim covering them would need its own evidence, not an extrapolation from these two.

## 9. Final decision

**PROCEED TO V0 HARNESS**, with the same scope discipline that governed this pass, not an expanded one.

The reviewer harness should be built around the defect classes that have now proven out across two independent builders: dead/duplicate/superseded components, ambiguous same-name module collisions, unreachable code the compiler already flags, and fragile external assets where they exist. It should not be built around v0 or Replit Agent support yet; that remains a claim to earn with its own falsification pass if and when it matters, not something to assume because Bolt transferred. Per `CLAUDE.md`, the harness is the smallest local addition inside `agent/` that reproduces this now-twice-proven manual workflow, not new infrastructure, and automation stays out of scope until the manual process has been repeated enough times to expose a stable pattern.

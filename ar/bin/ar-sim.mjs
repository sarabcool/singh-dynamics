#!/usr/bin/env node
// Human-readable simulator. Runs a curated subset of the scenario matrix
// and prints what Singh AR would decide at each step.
//
// Usage:
//   node bin/ar-sim.mjs                # run the six required demo scenarios
//   node bin/ar-sim.mjs 1 5 8          # run specific scenario ids
//   node bin/ar-sim.mjs --all          # run every scenario

import { EventRunner, Clock, evaluatePolicy, makeInvoiceSnapshot } from '../src/index.mjs';
import { allScenarios } from '../test/fixtures/scenarios.mjs';

// Mission spec requires simulation output for these six cases.
const REQUIRED_DEMO_IDS = [2, 3, 5, 10, 11, 8];

function pickIds(argv) {
  const args = argv.slice(2);
  if (args.length === 0) return REQUIRED_DEMO_IDS;
  if (args.includes('--all')) return allScenarios().map((s) => s.id);
  const ids = args.map((s) => Number(s)).filter(Number.isInteger);
  if (ids.length === 0) throw new Error(`no valid scenario ids in ${JSON.stringify(args)}`);
  return ids;
}

function money(cents) { return `$${(cents / 100).toFixed(2)}`; }

function renderProposal({ action, result }) {
  const stage = action.tone_stage ? ` stage ${action.tone_stage}` : '';
  const codes = result.reason_codes.length ? ` [${result.reason_codes.join(',')}]` : '';
  return `      -> propose ${action.kind}${stage}: ${result.decision} - ${result.reason}${codes}`;
}

function runScenario(s) {
  const invoice = makeInvoiceSnapshot(s.initialInvoice);
  const clock = new Clock(invoice.last_synced_at);
  const runner = new EventRunner({
    initialCase: s.initialCase, initialInvoice: invoice, policy: s.policy, clock,
  });
  runner.ingest(s.events);

  const snap = runner.snapshot();
  const out = [];
  out.push(`\nScenario ${s.id}: ${s.title}`);
  out.push(`  invoice ${invoice.provider_invoice_id} due ${invoice.due_date}, balance ${money(invoice.open_balance_cents)}`);
  out.push(`  policy ${s.policy.policy_version_id} (grace ${s.policy.grace_days}d, max reminders ${s.policy.max_routine_reminders})`);
  out.push(`  events:`);
  for (const e of runner.log) {
    if (e.kind === 'propose') out.push(renderProposal(e.payload));
    else out.push(`      -> ${e.kind}: ${typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload)}`);
  }
  out.push(`  final: status=${snap.case.status}, stage=${snap.case.reminder_stage}` +
    (snap.case.next_action_at ? `, next=${snap.case.next_action_at}` : ''));

  if (s.extraProposalCheck) {
    const res = evaluatePolicy({
      action: s.extraProposalCheck.action, arCase: snap.case, invoice: snap.invoice,
      policy: s.policy, clock, lastReply: snap.lastReply,
    });
    out.push(`  extra check (${s.extraProposalCheck.action.kind}): ${res.decision} - ${res.reason}`);
  }
  return out.join('\n');
}

const ids = pickIds(process.argv);
const scenarios = allScenarios().filter((s) => ids.includes(s.id));
console.log(`Singh AR simulator: running ${scenarios.length} scenario(s)`);
for (const s of scenarios) console.log(runScenario(s));
console.log(`\nDone.`);

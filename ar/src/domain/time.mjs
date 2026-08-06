// Time is always injected. Never call Date.now() in engine code.
// Clock.now() returns an ISO instant string in UTC.
// Business-day math is naive Mon-Fri; holidays are out of scope for V1 deterministic core.

export class Clock {
  constructor(nowIso) {
    if (!nowIso) throw new Error('Clock requires nowIso');
    this._now = nowIso;
  }
  now() { return this._now; }
  advanceTo(nextIso) { this._now = nextIso; }
  advanceHours(n) {
    const d = new Date(this._now);
    d.setUTCHours(d.getUTCHours() + n);
    this._now = d.toISOString();
  }
  advanceDays(n) { this.advanceHours(n * 24); }
}

export function parseIso(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`invalid iso: ${iso}`);
  return new Date(t);
}

// Add N business days to a base ISO instant. N=0 returns baseIso unchanged.
// A business day is Mon-Fri in UTC. This is intentionally simple for V1 core;
// real tenant timezones and holidays are enforced at the send-window layer.
export function addBusinessDaysIso(baseIso, n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`n must be non-negative int, got ${n}`);
  if (n === 0) return baseIso;
  const d = parseIso(baseIso);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(); // 0 Sun ... 6 Sat
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString();
}

export function addDaysIso(baseIso, n) {
  const d = parseIso(baseIso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}

export function diffDays(aIso, bIso) {
  const ms = parseIso(aIso).getTime() - parseIso(bIso).getTime();
  return Math.floor(ms / 86_400_000);
}

// Coerce YYYY-MM-DD to end-of-day UTC ISO instant for due-date comparisons.
// Due-date semantics: due AT end of the due date, not start.
export function dueDateToInstant(isoDate) {
  return `${isoDate}T23:59:59Z`;
}

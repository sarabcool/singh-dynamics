/**
 * D1 over the REST API.
 *
 * Extracted from the copy that was inline in sweep.mjs, because three more
 * scripts now need it and three more copies of a query helper is how you end up
 * with three subtly different error behaviours.
 *
 * Zero dependencies on purpose. Node 22 has fetch natively, so the workflows
 * that use this need no `npm ci` step at all, which takes ~20s off every run
 * and removes a whole class of lockfile failure.
 */

const {
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
} = process.env;

export function assertD1Env() {
  const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`missing env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

export async function d1(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    throw new Error(`D1 ${res.status}: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.result?.[0]?.results ?? [];
}

export async function d1First(sql, params = []) {
  const rows = await d1(sql, params);
  return rows[0] ?? null;
}

/**
 * Log an invocation to `runs`.
 *
 * Worth being pedantic about: the Worker's dispatch() writes ok=1 the moment
 * GitHub returns 204, which it does whether or not a workflow matched the event
 * type. So a `runs` row written by the Worker proves a dispatch was accepted,
 * not that anything ran. A row written by THIS function, from inside the
 * workflow, is the one that proves work happened. When reading the table, the
 * `trigger` column tells you which kind of row you are looking at.
 */
export async function logRun({
  job,
  trigger = process.env.GITHUB_EVENT_NAME || 'manual',
  ok = 1,
  itemsIn = 0,
  itemsOut = 0,
  costCents = 0,
  summary = null,
  error = null,
  // Cost accounting, kept separate on purpose. See migration 008.
  //   claudeCostCents  Claude spend for this run.
  //   claudeCostSource 'reported' when the API told us, 'estimated' when we
  //                    computed it from token counts. Never conflate the two.
  //   placesRequests   Google Places requests issued. A count. This process
  //                    cannot see Google's actual bill, so it does not invent
  //                    a dollar figure for it.
  claudeCostCents = null,
  claudeCostSource = null,
  placesRequests = 0,
}) {
  const claude = claudeCostCents ?? costCents ?? 0;
  try {
    await d1(
      `INSERT INTO runs (job, trigger, finished_at, ok, items_in, items_out,
                         cost_cents, claude_cost_cents, claude_cost_source,
                         places_requests, gh_run_url, summary, error)
       VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [job, trigger, ok, itemsIn, itemsOut, claude, claude, claudeCostSource,
       placesRequests, process.env.GITHUB_RUN_URL || null, summary, error]
    );
  } catch (e) {
    // Migration 008 may not be applied yet on a given database. Falling back to
    // the legacy column set keeps the audit trail intact instead of silently
    // losing every runs row until someone notices.
    try {
      await d1(
        `INSERT INTO runs (job, trigger, finished_at, ok, items_in, items_out,
                           cost_cents, gh_run_url, summary, error)
         VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
        [job, trigger, ok, itemsIn, itemsOut, claude,
         process.env.GITHUB_RUN_URL || null, summary, error]
      );
      console.error(`runs row written without cost split (apply migration 008): ${e.message}`);
    } catch (e2) {
      // Never let the audit write take down the job it is auditing.
      console.error(`could not write runs row: ${e2.message}`);
    }
  }
}

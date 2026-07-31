/**
 * Singh Dynamics, always-on layer.
 *
 * This Worker is the nervous system, not the brain. It does only work that is
 * deterministic and fast: cron firing, uptime probing, opt-out handling, and
 * rendering the approval digest.
 *
 * Anything requiring judgment is handed to GitHub Actions via repository_dispatch,
 * where the Agent SDK can run for hours with a full toolchain. The Worker cannot
 * do that itself: cron triggers cap at 15 minutes and CPU at 5 minutes on paid,
 * 10ms on free. That limit is the entire reason for the two-layer split.
 *
 * Free tier is fine until there is real traffic. Upgrade the $5 when a limit
 * actually bites, not before.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

export default {
  // -------------------------------------------------------------------------
  // scheduled
  // -------------------------------------------------------------------------
  async scheduled(event, env, ctx) {
    const cron = event.cron;

    if (cron === '0 7 * * *') {
      // 3am Eastern. Nightly lead discovery. Tier A, runs unattended.
      ctx.waitUntil(dispatch(env, 'discover-leads', {
        reason: 'nightly',
        at: new Date().toISOString(),
      }));
    }

    if (cron === '0 12 * * *') {
      // 8am Eastern. Build the daily approval digest before Sarab is awake,
      // so the three minutes he spends on it are the first thing available.
      ctx.waitUntil(dispatch(env, 'daily-digest', { reason: 'morning' }));
    }

    if (cron === '15 * * * *') {
      // Hourly uptime sweep. Cheap, deterministic, stays in the Worker.
      ctx.waitUntil(checkUptime(env));
    }
  },

  // -------------------------------------------------------------------------
  // fetch
  // -------------------------------------------------------------------------
  async fetch(request, env) {
    const url = new URL(request.url);

    // CAN-SPAM opt-out. Must work with no auth, no login, no friction, and
    // must be honored within 10 business days. We honor it immediately, which
    // is both simpler and the only defensible position.
    if (url.pathname === '/unsubscribe') {
      return handleUnsubscribe(url, env);
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: JSON_HEADERS,
      });
    }

    // Everything below is operator-only.
    if (!authorized(request, env)) {
      return new Response('unauthorized', { status: 401 });
    }

    if (url.pathname === '/digest') {
      return renderDigest(env);
    }

    if (url.pathname === '/approve' && request.method === 'POST') {
      return handleApproval(request, env);
    }

    if (url.pathname === '/trigger' && request.method === 'POST') {
      const { job } = await request.json();
      await dispatch(env, job, { reason: 'manual' });
      return new Response(JSON.stringify({ dispatched: job }), {
        headers: JSON_HEADERS,
      });
    }

    return new Response('not found', { status: 404 });
  },
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Constant-time-ish bearer check. Not a substitute for real auth if this ever
 * holds client PII, but correct for an operator-only surface with one user.
 */
function authorized(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!env.OPERATOR_TOKEN || token.length !== env.OPERATOR_TOKEN.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ env.OPERATOR_TOKEN.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Hand a reasoning job to GitHub Actions.
 * Requires a fine-grained PAT with Contents: read/write on this repo only.
 */
async function dispatch(env, job, payload) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'singh-dynamics-worker',
      },
      body: JSON.stringify({ event_type: job, client_payload: payload }),
    }
  );

  await env.DB.prepare(
    `INSERT INTO runs (job, trigger, ok, summary)
     VALUES (?, ?, ?, ?)`
  )
    .bind(job, payload.reason || 'cron', res.ok ? 1 : 0,
          res.ok ? 'dispatched' : `dispatch failed: ${res.status}`)
    .run();

  return res.ok;
}

/**
 * Probe every live client site. Writes results regardless of outcome so that
 * "no data" and "all healthy" are distinguishable, which they are not if you
 * only log failures.
 */
async function checkUptime(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, live_url FROM sites WHERE live_url IS NOT NULL`
  ).all();

  await Promise.all(
    results.map(async (site) => {
      const started = Date.now();
      let code = 0;
      let ok = 0;
      try {
        const res = await fetch(site.live_url, {
          method: 'GET',
          cf: { cacheTtl: 0 },
        });
        code = res.status;
        ok = res.ok ? 1 : 0;
      } catch {
        ok = 0;
      }
      const ms = Date.now() - started;

      await env.DB.prepare(
        `INSERT INTO uptime_checks (site_id, status_code, ms, ok)
         VALUES (?, ?, ?, ?)`
      ).bind(site.id, code, ms, ok).run();

      // Two consecutive failures, not one. A single blip on a global CDN is
      // noise, and an alert that cries wolf gets muted, which is worse than
      // no alert at all.
      if (!ok) {
        const { results: recent } = await env.DB.prepare(
          `SELECT ok FROM uptime_checks WHERE site_id = ?
           ORDER BY checked_at DESC LIMIT 2`
        ).bind(site.id).all();

        if (recent.length === 2 && recent.every((r) => !r.ok)) {
          await dispatch(env, 'site-down', { slug: site.slug, url: site.live_url });
        }
      }
    })
  );
}

/**
 * Opt-out. Suppression is global and permanent, and keyed independently of the
 * lead row: if someone opts out and the nightly sweep rediscovers them next
 * month, they stay suppressed.
 */
async function handleUnsubscribe(url, env) {
  const token = url.searchParams.get('t');
  if (!token) return new Response('missing token', { status: 400 });

  const lead = await env.DB.prepare(
    `SELECT id, email, phone, name FROM leads WHERE slug = ?`
  ).bind(token).first();

  if (lead) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE leads SET opted_out = 1,
                          opted_out_at = datetime('now'),
                          status = 'do_not_contact'
         WHERE id = ?`
      ).bind(lead.id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO suppression (email, phone, reason)
         VALUES (?, ?, 'user opt-out')`
      ).bind(lead.email, lead.phone),
      env.DB.prepare(
        `UPDATE approval_queue SET status = 'expired'
         WHERE lead_id = ? AND status = 'pending'`
      ).bind(lead.id),
    ]);
  }

  // Always confirm, even on an unknown token. Telling a stranger whether their
  // address is in the database is an information leak with no upside.
  return new Response(
    `<!doctype html><meta charset=utf-8>
     <meta name=viewport content="width=device-width,initial-scale=1">
     <title>Unsubscribed</title>
     <style>body{font:16px/1.6 system-ui;max-width:32rem;margin:15vh auto;
     padding:0 1.5rem;color:#1a1a1a}</style>
     <h1>You're unsubscribed.</h1>
     <p>You will not receive further email from Singh Dynamics.</p>`,
    { headers: { 'content-type': 'text/html;charset=utf-8' } }
  );
}

async function renderDigest(env) {
  const { results } = await env.DB.prepare(
    `SELECT q.id, q.action_type, q.summary, q.rationale, q.created_at,
            l.name AS lead_name, l.city
     FROM approval_queue q
     LEFT JOIN leads l ON l.id = q.lead_id
     WHERE q.status = 'pending' AND q.expires_at > datetime('now')
     ORDER BY q.created_at`
  ).all();

  return new Response(JSON.stringify({ pending: results.length, items: results }), {
    headers: JSON_HEADERS,
  });
}

async function handleApproval(request, env) {
  const { ids, decision, note } = await request.json();

  if (!['approved', 'rejected'].includes(decision)) {
    return new Response('bad decision', { status: 400 });
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Response('no ids', { status: 400 });
  }

  const placeholders = ids.map(() => '?').join(',');
  await env.DB.prepare(
    `UPDATE approval_queue
        SET status = ?, decided_at = datetime('now'), decided_note = ?
      WHERE id IN (${placeholders}) AND status = 'pending'`
  ).bind(decision, note || null, ...ids).run();

  // Execution is a separate job on purpose. Approving is instant; sending is
  // not, and the two failing independently is a feature.
  if (decision === 'approved') {
    await dispatch(env, 'execute-approved', { ids });
  }

  return new Response(JSON.stringify({ updated: ids.length, decision }), {
    headers: JSON_HEADERS,
  });
}

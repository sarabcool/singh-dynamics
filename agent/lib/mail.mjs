/**
 * Resend, thinnest possible wrapper.
 *
 * Two send functions, deliberately separate:
 *
 *   sendOperator()  mail to Sarab. Digests, alerts, failures. No compliance
 *                   surface, no unsubscribe, no suppression check. It is
 *                   internal mail to the person who owns the system.
 *
 *   sendProspect()  mail to a business that did not ask to hear from us. This
 *                   is the CAN-SPAM surface. It REFUSES to send without a
 *                   physical postal address and an unsubscribe link, because
 *                   those are legal requirements and a helper that lets you
 *                   forget them is a helper that will eventually let you forget
 *                   them at 3am with no human watching.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Must be on a domain verified in Resend. Until singhdynamics.com is verified
// there, sends will fail with a 403 and the reason will be in the response body.
export const MAIL_FROM =
  process.env.MAIL_FROM || 'Singh Dynamics <sarab@singhdynamics.com>';

export const OPERATOR_TO =
  process.env.OPERATOR_TO || 'sarab@singhdynamics.com';

// CAN-SPAM requires a valid physical postal address in every commercial email.
// A PO box is fine and is the sane choice here, for reasons that should be
// obvious when the operator is 16 and the address would otherwise be his house.
export const POSTAL_ADDRESS =
  process.env.POSTAL_ADDRESS || 'Singh Dynamics, Novi, MI 48375';

/**
 * Marks an error as worth retrying rather than fatal. `execute-approved.mjs`
 * reads this to decide whether to release the queue row back to `approved` (so
 * a later run picks it up) or bury it as `failed`.
 */
export class TransientMailError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransientMailError';
    this.transient = true;
  }
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

async function send({ to, subject, html, replyTo, headers = {}, attachments = [], idempotencyKey }) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');

  const payload = JSON.stringify({
    from: MAIL_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(attachments.length ? { attachments } : {}),
  });

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json',
          // Without this, a fetch that times out after Resend accepted the
          // message would be retried as a fresh send and a stranger gets the
          // same cold email twice. The key is derived from the queue row, so
          // every retry of one approved action carries the same value.
          ...(idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey) } : {}),
        },
        body: payload,
      });
    } catch (err) {
      // Network-level failure. We cannot know whether Resend received it, which
      // is exactly why the idempotency key above is not optional in practice.
      lastError = new TransientMailError(`resend network error: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) { await backoff(attempt); continue; }
      throw lastError;
    }

    const body = await res.json().catch(() => ({}));
    if (res.ok) return body.id;

    const detail = `resend ${res.status}: ${JSON.stringify(body)}`;
    if (RETRY_STATUSES.has(res.status)) {
      lastError = new TransientMailError(detail);
      if (attempt < MAX_ATTEMPTS) { await backoff(attempt, res.headers.get('retry-after')); continue; }
      throw lastError;
    }

    // 4xx that is not rate limiting is a real problem with the request. Retrying
    // it just burns quota and delays the operator finding out.
    throw new Error(detail);
  }

  throw lastError ?? new Error('resend send failed');
}

function backoff(attempt, retryAfter) {
  const headerSeconds = Number(retryAfter);
  const ms = Number.isFinite(headerSeconds) && headerSeconds > 0
    ? Math.min(headerSeconds * 1000, 30_000)
    : Math.min(500 * 2 ** (attempt - 1), 8_000);
  return new Promise((r) => setTimeout(r, ms));
}

export function sendOperator({ subject, html, to = OPERATOR_TO, attachments = [], idempotencyKey }) {
  return send({ to, subject, html, attachments, idempotencyKey });
}

export function sendProspect({ to, subject, html, unsubscribeUrl, replyTo, idempotencyKey }) {
  if (!unsubscribeUrl) {
    throw new Error('refusing to send prospect mail with no unsubscribe URL');
  }

  const footer = `
    <hr style="border:none;border-top:1px solid #e5e5e5;margin:2rem 0 1rem">
    <p style="font:13px/1.5 system-ui;color:#767676;margin:0">
      ${escapeHtml(POSTAL_ADDRESS)}<br>
      <a href="${unsubscribeUrl}" style="color:#767676">Unsubscribe</a>
      and you will not hear from us again.
    </p>`;

  return send({
    to,
    subject,
    html: html + footer,
    replyTo,
    idempotencyKey,
    // One-click unsubscribe. Gmail and Yahoo require this on bulk senders, and
    // honouring it is cheaper than the deliverability hit of not doing so.
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

export function sendInboundReply({ to, subject, html, replyTo, inReplyTo, references, idempotencyKey }) {
  const headers = {};
  const messageId = safeHeaderValue(inReplyTo);
  const refs = safeHeaderValue(references);

  if (messageId) headers['In-Reply-To'] = messageId;
  const referenceChain = [refs, messageId].filter(Boolean).join(' ');
  if (referenceChain) headers.References = referenceChain;

  return send({ to, subject, html, replyTo, headers, idempotencyKey });
}

function safeHeaderValue(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

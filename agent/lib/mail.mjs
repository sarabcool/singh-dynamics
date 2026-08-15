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
  process.env.OPERATOR_TO || 'khalsasarab3@gmail.com';

// CAN-SPAM requires a valid physical postal address in every commercial email.
// A PO box is fine and is the sane choice here, for reasons that should be
// obvious when the operator is 16 and the address would otherwise be his house.
export const POSTAL_ADDRESS =
  process.env.POSTAL_ADDRESS || 'Singh Dynamics, Novi, MI 48375';

async function send({ to, subject, html, replyTo, headers = {}, attachments = [] }) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(attachments.length ? { attachments } : {}),
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`resend ${res.status}: ${JSON.stringify(body)}`);
  return body.id;
}

export function sendOperator({ subject, html, to = OPERATOR_TO, attachments = [] }) {
  return send({ to, subject, html, attachments });
}

export function sendProspect({ to, subject, html, unsubscribeUrl, replyTo }) {
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
    // One-click unsubscribe. Gmail and Yahoo require this on bulk senders, and
    // honouring it is cheaper than the deliverability hit of not doing so.
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

export function sendInboundReply({ to, subject, html, replyTo, inReplyTo, references }) {
  const headers = {};
  const messageId = safeHeaderValue(inReplyTo);
  const refs = safeHeaderValue(references);

  if (messageId) headers['In-Reply-To'] = messageId;
  const referenceChain = [refs, messageId].filter(Boolean).join(' ');
  if (referenceChain) headers.References = referenceChain;

  return send({ to, subject, html, replyTo, headers });
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

const nodemailer = require('nodemailer');

function bool(v, def = false) {
  if (v == null || v === '') return def;
  const s = String(v).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes';
}

function getTransport() {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = bool(process.env.SMTP_SECURE, port === 465);
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';

  if (!host || !user || !pass) {
    const err = new Error('SMTP not configured. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS');
    err.code = 'smtp_not_configured';
    throw err;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

async function sendMail({ to, subject, text, html, replyTo }) {
  const transporter = getTransport();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@earnko.com';

  const info = await transporter.sendMail({
    from: `Earnko Support <${from}>`,
    to,
    subject,
    text,
    html,
    replyTo: replyTo || undefined
  });

  return info;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatTicketHtml({ ticket, user, actorLabel }) {
  const site = process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'https://earnko.com';
  const ticketId = String(ticket?._id || '');
  const subject = escapeHtml(ticket?.subject || 'Support Ticket');
  const status = escapeHtml(ticket?.status || 'open');
  const created = ticket?.createdAt ? new Date(ticket.createdAt).toLocaleString('en-IN') : '';
  const updated = ticket?.updatedAt ? new Date(ticket.updatedAt).toLocaleString('en-IN') : '';

  const header = `
    <div style="font-family:Inter,Arial,sans-serif; max-width:720px; margin:0 auto; padding:16px;">
      <div style="border:1px solid #e5e7eb; border-radius:14px; overflow:hidden;">
        <div style="background:linear-gradient(90deg,#2563eb,#06b6d4); padding:18px 16px; color:white;">
          <div style="font-size:16px; font-weight:800;">Earnko Support</div>
          <div style="opacity:.9; font-size:12px; margin-top:4px;">${actorLabel}</div>
        </div>
        <div style="padding:16px;">
          <div style="font-size:18px; font-weight:800; color:#0f172a;">${subject}</div>
          <div style="margin-top:8px; font-size:12px; color:#334155;">
            <b>Status:</b> ${status} &nbsp; • &nbsp; <b>Ticket:</b> ${escapeHtml(ticketId)}
          </div>
          <div style="margin-top:6px; font-size:12px; color:#64748b;">
            Created: ${escapeHtml(created)} &nbsp; • &nbsp; Updated: ${escapeHtml(updated)}
          </div>
          <div style="margin-top:12px; padding:12px; background:#f8fafc; border:1px solid #e5e7eb; border-radius:12px;">
            <div style="font-size:12px; font-weight:700; color:#0f172a; margin-bottom:6px;">User</div>
            <div style="font-size:13px; color:#0f172a;">
              ${escapeHtml(user?.name || '-')} &nbsp; &lt;${escapeHtml(user?.email || '-')}&gt;
            </div>
          </div>
  `;

  const initial = `
    <div style="margin-top:14px;">
      <div style="font-size:12px; font-weight:800; color:#0f172a; margin-bottom:6px;">Initial Message</div>
      <div style="white-space:pre-wrap; font-size:13px; line-height:1.6; color:#0f172a; padding:12px; border:1px solid #e5e7eb; border-radius:12px;">
        ${escapeHtml(ticket?.message || '')}
      </div>
    </div>
  `;

  const replies = Array.isArray(ticket?.replies) ? ticket.replies : [];
  const repliesHtml = replies.length
    ? `
      <div style="margin-top:16px;">
        <div style="font-size:12px; font-weight:800; color:#0f172a; margin-bottom:6px;">Conversation</div>
        ${replies.map(r => {
          const by = r?.by === 'admin' ? 'Admin' : 'User';
          const dt = r?.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '';
          return `
            <div style="margin-top:10px; padding:12px; border:1px solid #e5e7eb; border-radius:12px;">
              <div style="font-size:12px; color:#64748b;"><b>${escapeHtml(by)}</b> • ${escapeHtml(dt)}</div>
              <div style="margin-top:6px; white-space:pre-wrap; font-size:13px; line-height:1.6; color:#0f172a;">
                ${escapeHtml(r?.message || '')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `
    : '';

  const footer = `
        <div style="margin-top:16px; font-size:12px; color:#64748b;">
          Open in dashboard: <a href="${site.replace(/\/+$/,'')}/dashboard/support/${ticketId}">${escapeHtml(ticketId)}</a>
        </div>
      </div>
    </div>
  `;

  return header + initial + repliesHtml + footer;
}

function formatTicketText({ ticket, user }) {
  const lines = [];
  lines.push('Earnko Support');
  lines.push(`Ticket: ${ticket?._id || ''}`);
  lines.push(`Subject: ${ticket?.subject || ''}`);
  lines.push(`Status: ${ticket?.status || ''}`);
  lines.push(`User: ${user?.name || ''} <${user?.email || ''}>`);
  lines.push('');
  lines.push('Initial Message:');
  lines.push(ticket?.message || '');
  lines.push('');
  lines.push('Conversation:');
  const replies = Array.isArray(ticket?.replies) ? ticket.replies : [];
  for (const r of replies) {
    const by = r?.by === 'admin' ? 'Admin' : 'User';
    const dt = r?.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '';
    lines.push(`- ${by} • ${dt}`);
    lines.push(r?.message || '');
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = {
  sendMail,
  formatTicketHtml,
  formatTicketText
};
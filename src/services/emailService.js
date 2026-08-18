import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('SMTP not configured. Skipping email send.');
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) return { skipped: true };
  return t.sendMail({
    from: process.env.SMTP_FROM || `Involink <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]*>/g, ' '),
  });
}

const formatNaira = (amount) =>
  `₦${Number(amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Payment receipt (to the customer, or business owner).
export async function sendPaymentReceipt({ to, invoiceNumber, amount, reference, businessName, invoiceUrl }) {
  return sendMail({
    to,
    subject: `Payment received for ${invoiceNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
        <h2 style="color: #059669;">Payment Successful</h2>
        <p>Hi${businessName ? ` ${businessName}` : ''},</p>
        <p>Your payment has been received and your invoice is now marked as paid.</p>
        <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding:8px 0; color:#555;">Invoice</td><td style="padding:8px 0; text-align:right; font-weight:600;">${invoiceNumber}</td></tr>
          <tr><td style="padding:8px 0; color:#555;">Amount paid</td><td style="padding:8px 0; text-align:right; font-weight:600;">${formatNaira(amount)}</td></tr>
          <tr><td style="padding:8px 0; color:#555;">Reference</td><td style="padding:8px 0; text-align:right;">${reference}</td></tr>
        </table>
        ${invoiceUrl ? `<p><a href="${invoiceUrl}" style="color:#059669;">View your invoice</a></p>` : ''}
        <p style="color:#888; font-size:12px;">Thank you for using Involink.</p>
      </div>
    `,
  });
}

// Subscription activated / renewed.
export async function sendSubscriptionActivated({ to, plan, interval, expiresAt }) {
  return sendMail({
    to,
    subject: `Your Involink ${plan} plan is active 🎉`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
        <h2 style="color: #059669;">Welcome to ${plan}!</h2>
        <p>Your ${interval} subscription is now active.</p>
        <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding:8px 0; color:#555;">Plan</td><td style="padding:8px 0; text-align:right; font-weight:600;">${plan}</td></tr>
          <tr><td style="padding:8px 0; color:#555;">Billing cycle</td><td style="padding:8px 0; text-align:right; font-weight:600;">${interval}</td></tr>
          ${expiresAt ? `<tr><td style="padding:8px 0; color:#555;">Renews on</td><td style="padding:8px 0; text-align:right; font-weight:600;">${new Date(expiresAt).toLocaleDateString()}</td></tr>` : ''}
        </table>
        <p>You now have unlimited invoices, online payments, and branding tools unlocked.</p>
        <p style="color:#888; font-size:12px;">Questions? Just reply to this email.</p>
      </div>
    `,
  });
}

// Initial invoice email (to the client, with payment link).
export async function sendInvoiceEmail({ to, clientName, businessName, invoiceNumber, amount, dueDate, paymentUrl }) {
  return sendMail({
    to,
    subject: `Invoice ${invoiceNumber} from ${businessName || 'Involink'}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
        <h2 style="color: #059669;">You have an invoice to pay</h2>
        <p>Hi ${clientName || ''},</p>
        <p>${businessName || 'Your service provider'} has sent you an invoice for ${formatNaira(amount)}.</p>
        <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding:8px 0; color:#555;">Invoice</td><td style="padding:8px 0; text-align:right; font-weight:600;">${invoiceNumber}</td></tr>
          <tr><td style="padding:8px 0; color:#555;">Amount due</td><td style="padding:8px 0; text-align:right; font-weight:600;">${formatNaira(amount)}</td></tr>
          ${dueDate ? `<tr><td style="padding:8px 0; color:#555;">Due date</td><td style="padding:8px 0; text-align:right;">${new Date(dueDate).toLocaleDateString()}</td></tr>` : ''}
        </table>
        ${paymentUrl ? `<p style="text-align:center; margin: 24px 0;"><a href="${paymentUrl}" style="background-color:#059669; color:#fff; padding:12px 28px; text-decoration:none; border-radius:8px; font-weight:600; display:inline-block;">Pay Now</a></p>` : ''}
        <p style="color:#888; font-size:12px;">Questions? Just reply to this email.</p>
      </div>
    `,
  });
}

// Payment reminder (to the client, with payment link).
export async function sendInvoiceReminder({ to, clientName, businessName, invoiceNumber, amount, dueDate, paymentUrl, tone = 'friendly', daysOverdue = 0 }) {
  const isFirm = tone === 'firm';
  const subject = isFirm
    ? `Reminder: Invoice ${invoiceNumber} is overdue`
    : `Friendly reminder about invoice ${invoiceNumber}`;
  const heading = isFirm
    ? `Your invoice ${invoiceNumber} is ${daysOverdue > 0 ? 'overdue' : 'due'}.`
    : `Just a gentle nudge about invoice ${invoiceNumber}.`;
  const body = isFirm
    ? `<p>This is the second request for payment of ${formatNaira(amount)}${daysOverdue > 0 ? `, now ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} past due` : ''}. Please settle the balance at your earliest convenience to avoid disruption.</p>`
    : `<p>We noticed invoice ${invoiceNumber} for ${formatNaira(amount)}${daysOverdue > 0 ? ` (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue)` : ''} is still unpaid. No stress — if you've already paid, kindly ignore this. Otherwise, you can settle it in under a minute:</p>`;

  return sendMail({
    to,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
        <h2 style="color: ${isFirm ? '#d97706' : '#059669'};">${heading}</h2>
        <p>Hi ${clientName || ''},</p>
        ${body}
        <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding:8px 0; color:#555;">Invoice</td><td style="padding:8px 0; text-align:right; font-weight:600;">${invoiceNumber}</td></tr>
          <tr><td style="padding:8px 0; color:#555;">Amount due</td><td style="padding:8px 0; text-align:right; font-weight:600;">${formatNaira(amount)}</td></tr>
          ${dueDate ? `<tr><td style="padding:8px 0; color:#555;">Due date</td><td style="padding:8px 0; text-align:right;">${new Date(dueDate).toLocaleDateString()}</td></tr>` : ''}
        </table>
        ${paymentUrl ? `<p style="text-align:center; margin: 24px 0;"><a href="${paymentUrl}" style="background-color:${isFirm ? '#d97706' : '#059669'}; color:#fff; padding:12px 28px; text-decoration:none; border-radius:8px; font-weight:600; display:inline-block;">Pay Now</a></p>` : ''}
        <p style="color:#888; font-size:12px;">Sent via Involink — ${businessName || 'your provider'}.</p>
      </div>
    `,
  });
}

// Subscription cancelled.
export async function sendSubscriptionCancelled({ to, plan }) {
  return sendMail({
    to,
    subject: `Your Involink ${plan} subscription has been cancelled`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
        <h2 style="color: #059669;">Subscription cancelled</h2>
        <p>Your ${plan} subscription has been cancelled and your account has reverted to the Free plan.</p>
        <p>You can upgrade again any time from your dashboard.</p>
        <p style="color:#888; font-size:12px;">We'd love your feedback — just reply to this email.</p>
      </div>
    `,
  });
}

export default { sendPaymentReceipt, sendSubscriptionActivated, sendSubscriptionCancelled, sendInvoiceEmail, sendInvoiceReminder };
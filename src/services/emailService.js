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

export default { sendPaymentReceipt, sendSubscriptionActivated, sendSubscriptionCancelled };
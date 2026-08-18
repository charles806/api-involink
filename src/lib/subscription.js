// Shared helper for subscription plan logic.
// Plans live on the `users` table: subscription_plan ('free' | 'pro'),
// subscription_status ('active' | 'cancelled' | ...), subscription_expires_at.

export const FREE_QUOTA = 10;

// Whether a user record represents an active paid (Pro) subscription.
export function isPro(userRecord) {
  if (!userRecord) return false;
  const paidPlans = ['pro', 'enterprise'];
  if (!paidPlans.includes(userRecord.subscription_plan)) return false;
  if (!userRecord.subscription_expires_at) return true;
  return new Date(userRecord.subscription_expires_at) > new Date();
}

// Compute remaining free quota, or null when the user is on an active Pro plan.
export function remainingQuota(userRecord, invoiceCount) {
  if (isPro(userRecord)) return null;
  return Math.max(0, FREE_QUOTA - (invoiceCount || 0));
}

// Serialized public-facing subscription summary.
export function subscriptionSummary(userRecord) {
  if (!userRecord) userRecord = {};
  const pro = isPro(userRecord);
  return {
    plan: pro ? 'pro' : 'free',
    status: userRecord.subscription_status || 'active',
    isPro: pro,
    expiresAt: userRecord.subscription_expires_at || null,
    freeQuota: FREE_QUOTA,
  };
}
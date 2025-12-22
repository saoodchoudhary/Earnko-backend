const User = require('../models/User');
const Transaction = require('../models/Transaction');
const ReferralReward = require('../models/ReferralReward');

function getEnvNumber(name, def = 0) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}

/**
 * Compute referral bonus amount for a given approved commission
 * REFERRAL_BONUS_TYPE: percentage | fixed
 * REFERRAL_BONUS_VALUE: number (percent or ₹)
 * REFERRAL_BONUS_CAP: optional ₹ cap (0 = none)
 */
function computeReferralBonus(approvedCommission) {
  const type = String(process.env.REFERRAL_BONUS_TYPE || 'percentage').toLowerCase();
  const val = getEnvNumber('REFERRAL_BONUS_VALUE', 10);
  const cap = getEnvNumber('REFERRAL_BONUS_CAP', 0);

  let bonus = 0;
  if (type === 'fixed') bonus = Math.max(0, val);
  else bonus = Math.max(0, (approvedCommission * val) / 100);

  if (cap > 0) bonus = Math.min(bonus, cap);
  return Math.round(bonus * 100) / 100;
}

/**
 * Credit referral bonus when a transaction becomes approved.
 * Idempotent: creates one ReferralReward per (transaction, referrer).
 */
async function creditOnApprovedTransaction(transactionId) {
  const tx = await Transaction.findById(transactionId).lean();
  if (!tx || tx.status !== 'approved' || !tx.user) return null;

  const referredUser = await User.findById(tx.user).lean();
  const referrerId = referredUser?.referredBy;
  if (!referrerId) return null;

  const commission = Number(tx.commissionAmount || 0);
  const bonus = computeReferralBonus(commission);
  if (bonus <= 0) return null;

  // Create reward if not exists
  let reward = await ReferralReward.findOne({ transaction: tx._id, referrer: referrerId });
  if (!reward) {
    reward = await ReferralReward.create({
      referrer: referrerId,
      referred: referredUser._id,
      transaction: tx._id,
      amount: bonus,
      status: 'credited',
      notes: 'Referral bonus credited on approved transaction'
    });

    // Credit referrer wallet
    await User.updateOne(
      { _id: referrerId },
      {
        $inc: {
          'wallet.referralEarnings': bonus,
          'wallet.availableBalance': bonus
        }
      }
    );
  }
  return reward;
}

/**
 * Reverse referral bonus if an already-approved transaction is later rejected/voided.
 * Idempotent: only reverses a previously credited reward once.
 */
async function reverseOnRejection(transactionId) {
  const reward = await ReferralReward.findOne({ transaction: transactionId, status: 'credited' });
  if (!reward) return null; // nothing to reverse

  reward.status = 'reversed';
  reward.notes = 'Referral bonus reversed due to transaction rejection';
  await reward.save();

  // Debit referrer wallet
  await User.updateOne(
    { _id: reward.referrer },
    {
      $inc: {
        'wallet.referralEarnings': -Math.abs(reward.amount || 0),
        'wallet.availableBalance': -Math.abs(reward.amount || 0)
      }
    }
  );
  return reward;
}

module.exports = { computeReferralBonus, creditOnApprovedTransaction, reverseOnRejection };
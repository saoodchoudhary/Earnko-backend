const Commission = require('../models/Commission');
const User = require('../models/User');
const Store = require('../models/Store');
const CategoryCommission = require('../models/CategoryCommission');
const Click = require('../models/Click');
const Product = require('../models/Product');

async function getCommissionRule(storeId, categoryKey) {
  if (storeId && categoryKey) {
    const storeRule = await CategoryCommission.findOne({ store: storeId, categoryKey, isActive: true }).lean();
    if (storeRule) return storeRule;
  }
  if (categoryKey) {
    const globalRule = await CategoryCommission.findOne({ store: null, categoryKey, isActive: true }).lean();
    if (globalRule) return globalRule;
  }
  return null;
}

function computeCommission(orderAmount, rule, fallbackRate = 0, fallbackType = 'percentage', fallbackMax = null) {
  const type = rule?.commissionType || fallbackType;
  const rate = rule?.commissionRate != null ? rule.commissionRate : fallbackRate;
  const maxCap = rule && rule.maxCap != null ? rule.maxCap : fallbackMax;

  let commission = 0;
  if (type === 'percentage') commission = (orderAmount * rate) / 100;
  else commission = rate;

  if (maxCap != null) commission = Math.min(commission, maxCap);
  return Math.round(commission * 100) / 100;
}

async function processTransaction(transactionId) {
  const tx = await require('../models/Transaction').findById(transactionId);
  if (!tx) throw new Error('Transaction not found');

  const existing = await Commission.findOne({ transaction: tx._id });
  if (existing) return existing;

  // If productId is present in trackingData, load product (and prefer its store)
  let product = null;
  const tracking = tx.trackingData || {};
  if (tracking.productId) {
    try { product = await Product.findById(tracking.productId).lean(); } catch {}
    if (!tx.store && product?.store) tx.store = product.store;
  }

  const store = tx.store ? await Store.findById(tx.store).lean() : null;

  // Fallbacks from store
  const fallbackRate = store?.commissionRate || 0;
  const fallbackType = store?.commissionType || 'percentage';
  const fallbackMax = store?.maxCommission || null;

  // Decide rule priority: product override > category rule > store fallback
  let rule = null;
  if (product?.commissionOverride?.rate != null && product?.commissionOverride?.type) {
    rule = {
      commissionRate: product.commissionOverride.rate,
      commissionType: product.commissionOverride.type,
      maxCap: product.commissionOverride.maxCap ?? null
    };
  } else {
    const categoryKey = tracking.categoryKey || tx.productCategory || product?.categoryKey || null;
    rule = await getCommissionRule(tx.store, categoryKey);
  }

  const amount = computeCommission(tx.productAmount || tx.amount || 0, rule, fallbackRate, fallbackType, fallbackMax);
  tx.commissionAmount = amount;
  await tx.save();

  // determine affiliate id
  let affiliateId = tx.affiliateData?.affiliate;
  if (!affiliateId && tx.clickId) {
    const click = await Click.findOne({ clickId: tx.clickId }).lean();
    affiliateId = click?.user;
  }
  if (!affiliateId) return null;

  const commission = await Commission.create({
    affiliate: affiliateId,
    store: tx.store,
    transaction: tx._id,
    amount,
    rate: rule?.commissionRate || fallbackRate,
    type: rule?.commissionType || fallbackType,
    status: 'pending',
    metadata: {
      productId: product?._id || null,
      appliedRule: rule ? { commissionType: rule.commissionType, commissionRate: rule.commissionRate, maxCap: rule.maxCap ?? null } : null
    }
  });

  await User.findByIdAndUpdate(affiliateId, {
    $inc: {
      'wallet.pendingCashback': amount,
      'wallet.totalEarnings': amount,
      'affiliateInfo.pendingCommissions': amount,
      'affiliateInfo.totalCommissions': amount
    }
  });

  if (store) {
    await Store.findByIdAndUpdate(store._id, { $inc: { 'stats.totalConversions': 1, 'stats.totalCommission': amount } });
  }

  return commission;
}

module.exports = { processTransaction, computeCommission };
function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positiveAmount(value, name = '金额') {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${name}无效`);
  return amount;
}

function walletBalances(wallet) {
  if (!wallet) throw new Error('钱包不存在');
  // 旧字段只在新字段为 null/undefined 时兼容，不能把合法的 0 当作缺失。
  const quota = numeric(wallet.quota_balance ?? wallet.recharge_balance);
  const gift = numeric(wallet.gift_quota ?? wallet.gift_balance);
  const frozen = numeric(wallet.frozen_balance);
  return { quota, gift, frozen, available: quota + gift - frozen };
}

function insertTransaction(db, values) {
  db.prepare(`INSERT INTO wallet_transactions
    (user_id,transaction_type,balance_type,amount,before_balance,after_balance,related_request_id,remark)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    values.userId, values.transactionType, values.balanceType, values.amount,
    values.beforeBalance, values.afterBalance, values.requestId, values.remark,
  );
}

/**
 * 在转发上游前原子冻结本次调用的保守最大预算。
 * 调用方必须按输入估算和最大输出上限计算预算；不能冻结整个钱包，否则会阻断合法并发请求。
 */
function reserveWalletBalance(db, userId, amount, requestId) {
  const reserve = positiveAmount(amount, '冻结额度');
  if (reserve <= 0) throw new Error('额度不足');

  return db.transaction(() => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
    const { frozen, available } = walletBalances(wallet);
    if (available + 1e-9 < reserve) throw new Error('额度不足');

    db.prepare('UPDATE wallets SET frozen_balance=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?')
      .run(frozen + reserve, userId);
    insertTransaction(db, {
      userId,
      transactionType: 'freeze',
      balanceType: 'frozen',
      amount: reserve,
      beforeBalance: frozen,
      afterBalance: frozen + reserve,
      requestId,
      remark: 'API 调用额度冻结',
    });
    return { reserved: reserve };
  });
}

function releaseWalletReservation(db, userId, amount, requestId, remark = 'API 调用未完成，释放冻结额度') {
  const reserved = positiveAmount(amount, '冻结额度');
  if (reserved === 0) return { released: 0 };

  return db.transaction(() => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
    const { frozen } = walletBalances(wallet);
    if (frozen + 1e-9 < reserved) throw new Error('冻结额度异常');

    db.prepare('UPDATE wallets SET frozen_balance=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?')
      .run(Math.max(0, frozen - reserved), userId);
    insertTransaction(db, {
      userId,
      transactionType: 'unfreeze',
      balanceType: 'frozen',
      amount: -reserved,
      beforeBalance: frozen,
      afterBalance: Math.max(0, frozen - reserved),
      requestId,
      remark,
    });
    return { released: reserved };
  });
}

/**
 * 用真实用量完成结算，并与调用成功日志放进同一事务。
 * 若任一步失败，扣款、流水和成功日志会一起回滚。若真实费用意外超过冻结额，
 * 会精确扣到负余额（形成可追溯欠费）而非免费放行。
 */
function settleWalletReservation(db, { userId, reservedAmount, chargeAmount, requestId, writeSuccessLog }) {
  const reserved = positiveAmount(reservedAmount, '冻结额度');
  const charge = positiveAmount(chargeAmount, '扣费金额');
  return db.transaction(() => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
    const { quota, gift, frozen } = walletBalances(wallet);
    if (frozen + 1e-9 < reserved) throw new Error('冻结额度异常');

    const giftCharged = Math.min(gift, charge);
    const quotaCharged = charge - giftCharged;

    const newGift = gift - giftCharged;
    const newQuota = quota - quotaCharged;
    const newFrozen = Math.max(0, frozen - reserved);
    db.prepare('UPDATE wallets SET quota_balance=?, gift_quota=?, frozen_balance=?, total_spent=total_spent+?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?')
      .run(newQuota, newGift, newFrozen, charge, userId);

    const debtCreated = Math.max(0, charge - reserved);
    if (giftCharged > 0) {
      insertTransaction(db, {
        userId, transactionType: 'consume', balanceType: 'gift_quota', amount: -giftCharged,
        beforeBalance: gift, afterBalance: newGift, requestId, remark: 'API 调用扣费',
      });
    }
    if (quotaCharged > 0) {
      insertTransaction(db, {
        userId, transactionType: 'consume', balanceType: 'quota', amount: -quotaCharged,
        beforeBalance: quota, afterBalance: newQuota, requestId,
        remark: debtCreated > 0 ? 'API 调用超额结算（已形成欠费）' : 'API 调用扣费',
      });
    }
    insertTransaction(db, {
      userId, transactionType: 'unfreeze', balanceType: 'frozen', amount: -reserved,
      beforeBalance: frozen, afterBalance: newFrozen, requestId,
      remark: charge > 0 ? 'API 调用结算，释放冻结额度' : 'API 调用无费用，释放冻结额度',
    });
    if (writeSuccessLog) writeSuccessLog();
    return { charged: charge, giftCharged, quotaCharged, released: reserved, debtCreated };
  });
}

// 保留给旧调用与单元测试的直接扣款入口；生产代理统一走“冻结→结算”。
function deductWalletBalance(db, userId, amount, requestId = null) {
  const charge = positiveAmount(amount, '扣费金额');
  if (charge === 0) return { charged: 0, giftCharged: 0, quotaCharged: 0 };
  return db.transaction(() => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
    const { quota, gift, available } = walletBalances(wallet);
    if (available + 1e-9 < charge) throw new Error('额度不足');
    const giftCharged = Math.min(gift, charge);
    const quotaCharged = charge - giftCharged;
    const newGift = gift - giftCharged;
    const newQuota = quota - quotaCharged;
    db.prepare('UPDATE wallets SET quota_balance=?, gift_quota=?, total_spent=total_spent+?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?')
      .run(newQuota, newGift, charge, userId);
    if (giftCharged > 0) insertTransaction(db, { userId, transactionType: 'consume', balanceType: 'gift_quota', amount: -giftCharged, beforeBalance: gift, afterBalance: newGift, requestId, remark: 'API 调用扣费' });
    if (quotaCharged > 0) insertTransaction(db, { userId, transactionType: 'consume', balanceType: 'quota', amount: -quotaCharged, beforeBalance: quota, afterBalance: newQuota, requestId, remark: 'API 调用扣费' });
    return { charged: charge, giftCharged, quotaCharged };
  });
}

module.exports = {
  deductWalletBalance,
  releaseWalletReservation,
  reserveWalletBalance,
  settleWalletReservation,
  walletBalances,
};

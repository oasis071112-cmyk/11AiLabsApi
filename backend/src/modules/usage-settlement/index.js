const MONEY_SCALE = 1_000_000;

function quantizeAmount(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return normalized;
  return Math.round((normalized + Number.EPSILON) * MONEY_SCALE) / MONEY_SCALE;
}

function amount(value, name) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) throw new Error(`${name}无效`);
  return quantizeAmount(normalized);
}

function balances(wallet) {
  if (!wallet) throw new Error('钱包不存在');
  const quota = quantizeAmount(wallet.quota_balance ?? wallet.recharge_balance ?? 0);
  const gift = quantizeAmount(wallet.gift_quota ?? wallet.gift_balance ?? 0);
  const frozen = quantizeAmount(wallet.frozen_balance ?? 0);
  const totalSpent = quantizeAmount(wallet.total_spent ?? 0);
  return { quota, gift, frozen, totalSpent, available: quantizeAmount(quota + gift - frozen) };
}

function ledger({ userId, requestId, type, balanceType, value, before, after, remark }) {
  return {
    user_id: userId,
    transaction_type: type,
    balance_type: balanceType,
    amount: value,
    before_balance: before,
    after_balance: after,
    related_request_id: requestId,
    remark,
  };
}

function requireRequestId(requestId) {
  const value = String(requestId || '').trim();
  if (!value) throw new Error('requestId不能为空');
  return value;
}

function reservationAmount(reservation) {
  return Number(reservation?.reserved_amount ?? reservation?.reservedAmount ?? 0);
}

function assertReservation(reservation, { userId, reservedAmount, requestId }) {
  if (!reservation) throw new Error(`冻结记录不存在: ${requestId}`);
  if (String(reservation.user_id ?? reservation.userId) !== String(userId)) {
    throw new Error('冻结记录与用户不匹配');
  }
  if (quantizeAmount(reservationAmount(reservation)) !== quantizeAmount(reservedAmount)) {
    throw new Error('冻结记录金额不匹配');
  }
}

class UsageSettlement {
  constructor({ repository } = {}) {
    if (!repository?.transaction) throw new Error('UsageSettlement repository is required');
    this.repository = repository;
  }

  async reserve({ userId, apiKeyId = null, amount: requestedAmount, requestId }) {
    const reserve = amount(requestedAmount, '冻结额度');
    if (reserve <= 0) throw new Error('额度不足');
    const stableRequestId = requireRequestId(requestId);
    return this.repository.transaction(async tx => {
      const { reservation, created } = await tx.getOrCreateReservation({
        requestId: stableRequestId,
        userId,
        apiKeyId,
        reservedAmount: reserve,
      });
      assertReservation(reservation, { userId, reservedAmount: reserve, requestId: stableRequestId });
      if (!created) {
        return { reserved: reserve, idempotent: true, status: reservation.status };
      }
      const wallet = await tx.lockWallet(userId);
      const current = balances(wallet);
      if (current.available + 1e-9 < reserve) throw new Error('额度不足');
      const nextFrozen = quantizeAmount(current.frozen + reserve);
      await tx.updateWallet(userId, { frozen_balance: nextFrozen });
      await tx.appendWalletTransaction(ledger({
        userId, requestId: stableRequestId, type: 'freeze', balanceType: 'frozen', value: reserve,
        before: current.frozen, after: nextFrozen, remark: 'API 调用额度冻结',
      }));
      return { reserved: reserve };
    });
  }

  async release({ userId, reservedAmount, requestId, remark = 'API 调用未完成，释放冻结额度' }) {
    const reserved = amount(reservedAmount, '冻结额度');
    if (reserved === 0) return { released: 0 };
    const stableRequestId = requireRequestId(requestId);
    return this.repository.transaction(async tx => {
      const reservation = await tx.lockReservation(stableRequestId);
      assertReservation(reservation, { userId, reservedAmount: reserved, requestId: stableRequestId });
      if (reservation.status === 'released') return { released: reserved, idempotent: true };
      if (reservation.status !== 'reserved') throw new Error(`冻结记录状态不可释放: ${reservation.status}`);
      const current = balances(await tx.lockWallet(userId));
      if (current.frozen + 1e-9 < reserved) throw new Error('冻结额度异常');
      const nextFrozen = quantizeAmount(Math.max(0, current.frozen - reserved));
      await tx.updateWallet(userId, { frozen_balance: nextFrozen });
      await tx.appendWalletTransaction(ledger({
        userId, requestId: stableRequestId, type: 'unfreeze', balanceType: 'frozen', value: -reserved,
        before: current.frozen, after: nextFrozen, remark,
      }));
      await tx.updateReservation(stableRequestId, {
        status: 'released',
        result: { released: reserved },
      });
      return { released: reserved };
    });
  }

  async settle({ userId, reservedAmount, chargeAmount, requestId, successLog, resultMetadata = {} }) {
    return this.settleReservation({
      userId,
      reservedAmount,
      chargeAmount,
      requestId,
      expectedStatus: 'reserved',
      appendLog: successLog,
      resultMetadata,
    });
  }

  async resolvePending({
    userId,
    reservedAmount,
    chargeAmount,
    requestId,
    reservationStatus = 'pending_review',
    logIdentity = null,
    logUpdates,
    fallbackLog = null,
    resultMetadata = {},
  }) {
    return this.settleReservation({
      userId,
      reservedAmount,
      chargeAmount,
      requestId,
      expectedStatus: reservationStatus,
      logIdentity,
      appendLog: fallbackLog,
      updateLog: logUpdates,
      resultMetadata,
    });
  }

  async settleReservation({
    userId,
    reservedAmount,
    chargeAmount,
    requestId,
    expectedStatus,
    appendLog,
    logIdentity,
    updateLog,
    resultMetadata,
  }) {
    const reserved = amount(reservedAmount, '冻结额度');
    const requestedCharge = amount(chargeAmount, '扣费金额');
    const charge = quantizeAmount(Math.min(requestedCharge, reserved));
    const platformAbsorbed = quantizeAmount(Math.max(0, requestedCharge - charge));
    const stableRequestId = requireRequestId(requestId);
    return this.repository.transaction(async tx => {
      const reservation = await tx.lockReservation(stableRequestId);
      assertReservation(reservation, { userId, reservedAmount: reserved, requestId: stableRequestId });
      if (reservation.status === 'settled') {
        return { ...(reservation.result || {}), idempotent: true };
      }
      if (reservation.status !== expectedStatus) throw new Error(`冻结记录状态不可结算: ${reservation.status}`);
      const current = balances(await tx.lockWallet(userId));
      if (current.frozen + 1e-9 < reserved) throw new Error('冻结额度异常');
      const otherFrozen = quantizeAmount(Math.max(0, current.frozen - reserved));
      const billableFunds = quantizeAmount(Math.max(0, current.quota + current.gift - otherFrozen));
      if (charge > billableFunds + 1e-9) {
        throw new Error('冻结记录对应的可结算余额不足');
      }
      const giftCharged = quantizeAmount(Math.min(current.gift, charge));
      const quotaCharged = quantizeAmount(charge - giftCharged);
      const nextGift = quantizeAmount(current.gift - giftCharged);
      const nextQuota = quantizeAmount(current.quota - quotaCharged);
      const nextFrozen = quantizeAmount(Math.max(0, current.frozen - reserved));
      await tx.updateWallet(userId, {
        quota_balance: nextQuota,
        gift_quota: nextGift,
        frozen_balance: nextFrozen,
        total_spent: quantizeAmount(current.totalSpent + charge),
      });
      if (giftCharged > 0) {
        await tx.appendWalletTransaction(ledger({
          userId, requestId: stableRequestId, type: 'consume', balanceType: 'gift_quota', value: -giftCharged,
          before: current.gift, after: nextGift, remark: 'API 调用扣费',
        }));
      }
      if (quotaCharged > 0) {
        await tx.appendWalletTransaction(ledger({
          userId, requestId: stableRequestId, type: 'consume', balanceType: 'quota', value: -quotaCharged,
          before: current.quota, after: nextQuota,
          remark: 'API 调用扣费',
        }));
      }
      await tx.appendWalletTransaction(ledger({
        userId, requestId: stableRequestId, type: 'unfreeze', balanceType: 'frozen', value: -reserved,
        before: current.frozen, after: nextFrozen,
        remark: charge > 0 ? 'API 调用结算，释放冻结额度' : 'API 调用无费用，释放冻结额度',
      }));
      const result = {
        charged: charge,
        giftCharged,
        quotaCharged,
        released: reserved,
        debtCreated: 0,
        ...(platformAbsorbed > 0 ? { requestedCharge, platformAbsorbed } : {}),
        ...resultMetadata,
      };
      const settlementSnapshot = {
        ...resultMetadata,
        requested_charge: requestedCharge,
        charged_amount: charge,
        platform_absorbed: platformAbsorbed,
      };
      if (appendLog) await tx.appendRequestLog({
        ...appendLog,
        total_cost: charge,
        ...(platformAbsorbed > 0 || Object.keys(resultMetadata).length > 0 ? {
          billing_snapshot: {
            ...(appendLog.billing_snapshot || {}),
            settlement: settlementSnapshot,
          },
        } : {}),
        request_id: appendLog.request_id || stableRequestId,
      });
      if (updateLog) await tx.updateRequestLog(logIdentity || stableRequestId, {
        ...updateLog,
        total_cost: charge,
        pending_reserved_amount: 0,
        billing_snapshot: {
          ...(updateLog.billing_snapshot || {}),
          settlement: settlementSnapshot,
        },
      });
      await tx.updateReservation(stableRequestId, {
        status: 'settled',
        charged_amount: charge,
        result,
      });
      return result;
    });
  }

  async markPending({ userId, reservedAmount, requestId, log }) {
    const reserved = amount(reservedAmount, '冻结额度');
    const stableRequestId = requireRequestId(requestId);
    return this.repository.transaction(async tx => {
      const reservation = await tx.lockReservation(stableRequestId);
      assertReservation(reservation, { userId, reservedAmount: reserved, requestId: stableRequestId });
      if (reservation.status === 'pending_review') return { pending: reserved, idempotent: true };
      if (reservation.status !== 'reserved') throw new Error(`冻结记录状态不可待核对: ${reservation.status}`);
      const current = balances(await tx.lockWallet(userId));
      if (current.frozen + 1e-9 < reserved) throw new Error('冻结额度异常');
      await tx.appendRequestLog({ ...log, pending_reserved_amount: reserved, request_id: log?.request_id || stableRequestId });
      await tx.updateReservation(stableRequestId, {
        status: 'pending_review',
        result: { pending: reserved },
      });
      return { pending: reserved };
    });
  }
}

module.exports = { MONEY_SCALE, UsageSettlement, quantizeAmount, settlementBalances: balances };

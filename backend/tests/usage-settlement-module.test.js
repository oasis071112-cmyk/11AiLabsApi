import { describe, expect, it } from 'vitest';
import { UsageSettlement } from '../src/modules/usage-settlement/index.js';

const postgresMoney = value => Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;

function fakeSettlementRepository(initialWallet, initialReservations = {}) {
  const state = {
    wallet: { ...initialWallet },
    transactions: [],
    logs: [],
    reservations: JSON.parse(JSON.stringify(initialReservations)),
  };
  return {
    state,
    async transaction(work) {
      const snapshot = JSON.parse(JSON.stringify(state));
      const tx = {
        lockWallet: async () => ({ ...state.wallet }),
        updateWallet: async (_userId, values) => Object.assign(state.wallet, values),
        appendWalletTransaction: async value => state.transactions.push(value),
        appendRequestLog: async value => state.logs.push(value),
        async updateRequestLog(identity, values) {
          const log = identity && typeof identity === 'object'
            ? state.logs.find(item => String(item.id) === String(identity.id)
              && String(item.created_at) === String(identity.createdAt))
            : state.logs.find(item => item.request_id === identity);
          if (log) Object.assign(log, values, {
            billing_snapshot: {
              ...(log.billing_snapshot || {}),
              ...(values.billing_snapshot || {}),
            },
          });
        },
        async getOrCreateReservation(value) {
          const existing = state.reservations[value.requestId];
          if (existing) return { reservation: { ...existing }, created: false };
          const reservation = {
            request_id: value.requestId,
            user_id: value.userId,
            api_key_id: value.apiKeyId || null,
            reserved_amount: postgresMoney(value.reservedAmount),
            charged_amount: 0,
            status: 'reserved',
            result: {},
          };
          state.reservations[value.requestId] = reservation;
          return { reservation: { ...reservation }, created: true };
        },
        async lockReservation(requestId) {
          const value = state.reservations[requestId];
          return value ? { ...value } : null;
        },
        async updateReservation(requestId, values) {
          Object.assign(state.reservations[requestId], values);
        },
      };
      try {
        return await work(tx);
      } catch (error) {
        state.wallet = snapshot.wallet;
        state.transactions = snapshot.transactions;
        state.logs = snapshot.logs;
        state.reservations = snapshot.reservations;
        throw error;
      }
    },
  };
}

describe('UsageSettlement', () => {
  it('freezes only the requested budget under a wallet transaction', async () => {
    const repository = fakeSettlementRepository({ quota_balance: 8, gift_quota: 2, frozen_balance: 1, total_spent: 0 });
    const settlement = new UsageSettlement({ repository });

    const result = await settlement.reserve({ userId: 3, amount: 4, requestId: 'req_freeze' });

    expect(result).toEqual({ reserved: 4 });
    expect(repository.state.wallet.frozen_balance).toBe(5);
    expect(repository.state.transactions).toMatchObject([
      { transaction_type: 'freeze', balance_type: 'frozen', amount: 4, related_request_id: 'req_freeze' },
    ]);
  });

  it('does not freeze twice when the same request id is reserved again', async () => {
    const repository = fakeSettlementRepository({ quota_balance: 8, gift_quota: 2, frozen_balance: 0, total_spent: 0 });
    const settlement = new UsageSettlement({ repository });

    await settlement.reserve({ userId: 3, apiKeyId: 7, amount: 4, requestId: 'req_replayed' });
    const replay = await settlement.reserve({ userId: 3, apiKeyId: 7, amount: 4, requestId: 'req_replayed' });

    expect(replay).toEqual({ reserved: 4, idempotent: true, status: 'reserved' });
    expect(repository.state.wallet.frozen_balance).toBe(4);
    expect(repository.state.transactions).toHaveLength(1);
  });

  it('uses PostgreSQL six-decimal precision as the idempotency amount boundary', async () => {
    const repository = fakeSettlementRepository({ quota_balance: 8, gift_quota: 0, frozen_balance: 0, total_spent: 0 });
    const settlement = new UsageSettlement({ repository });

    const first = await settlement.reserve({
      userId: 3,
      amount: 0.2867375,
      requestId: 'req_fractional_price',
    });
    const replay = await settlement.reserve({
      userId: 3,
      amount: 0.2867375,
      requestId: 'req_fractional_price',
    });

    expect(first.reserved).toBe(0.286738);
    expect(replay).toMatchObject({ reserved: 0.286738, idempotent: true });
    expect(repository.state.wallet.frozen_balance).toBe(0.286738);
  });

  it('settles balances and the success log atomically, refunding the unused reservation', async () => {
    const repository = fakeSettlementRepository(
      { quota_balance: 8, gift_quota: 2, frozen_balance: 5, total_spent: 0 },
      { req_settle: { request_id: 'req_settle', user_id: 3, reserved_amount: 4, charged_amount: 0, status: 'reserved', result: {} } },
    );
    const settlement = new UsageSettlement({ repository });

    const result = await settlement.settle({
      userId: 3,
      reservedAmount: 4,
      chargeAmount: 2.5,
      requestId: 'req_settle',
      successLog: { request_id: 'req_settle', status: 'success', total_cost: 2.5 },
    });

    expect(result).toEqual({ charged: 2.5, giftCharged: 2, quotaCharged: 0.5, released: 4, debtCreated: 0 });
    expect(repository.state.wallet).toMatchObject({ quota_balance: 7.5, gift_quota: 0, frozen_balance: 1, total_spent: 2.5 });
    expect(repository.state.logs).toEqual([{ request_id: 'req_settle', status: 'success', total_cost: 2.5 }]);
  });

  it('caps the final charge at the reservation and records the platform-covered difference', async () => {
    const repository = fakeSettlementRepository(
      { quota_balance: 3, gift_quota: 0, frozen_balance: 2, total_spent: 0 },
      { req_shortfall: { request_id: 'req_shortfall', user_id: 3, reserved_amount: 2, charged_amount: 0, status: 'reserved', result: {} } },
    );
    const settlement = new UsageSettlement({ repository });

    const result = await settlement.settle({
      userId: 3,
      reservedAmount: 2,
      chargeAmount: 4,
      requestId: 'req_shortfall',
      successLog: { request_id: 'req_shortfall', status: 'success', total_cost: 4 },
    });

    expect(result).toMatchObject({ charged: 2, requestedCharge: 4, platformAbsorbed: 2, released: 2 });
    expect(repository.state.wallet).toEqual({ quota_balance: 1, gift_quota: 0, frozen_balance: 0, total_spent: 2 });
    expect(repository.state.reservations.req_shortfall).toMatchObject({ status: 'settled', charged_amount: 2 });
    expect(repository.state.logs).toEqual([expect.objectContaining({
      request_id: 'req_shortfall', status: 'success', total_cost: 2,
      billing_snapshot: expect.objectContaining({
        settlement: expect.objectContaining({ requested_charge: 4, platform_absorbed: 2 }),
      }),
    })]);
  });

  it('returns the prior result without charging or logging twice when settlement is replayed', async () => {
    const repository = fakeSettlementRepository(
      { quota_balance: 8, gift_quota: 2, frozen_balance: 4, total_spent: 0 },
      { req_once: { request_id: 'req_once', user_id: 3, reserved_amount: 4, charged_amount: 0, status: 'reserved', result: {} } },
    );
    const settlement = new UsageSettlement({ repository });
    const request = {
      userId: 3,
      reservedAmount: 4,
      chargeAmount: 1,
      requestId: 'req_once',
      successLog: { request_id: 'req_once', status: 'success', total_cost: 1 },
    };

    const first = await settlement.settle(request);
    const replay = await settlement.settle(request);

    expect(replay).toEqual({ ...first, idempotent: true });
    expect(repository.state.wallet).toMatchObject({ quota_balance: 8, gift_quota: 1, frozen_balance: 0, total_spent: 1 });
    expect(repository.state.logs).toHaveLength(1);
  });

  it('rolls back wallet and ledger changes if logging fails', async () => {
    const repository = fakeSettlementRepository(
      { quota_balance: 8, gift_quota: 2, frozen_balance: 4, total_spent: 0 },
      { req_rollback: { request_id: 'req_rollback', user_id: 3, reserved_amount: 4, charged_amount: 0, status: 'reserved', result: {} } },
    );
    const originalTransaction = repository.transaction.bind(repository);
    repository.transaction = work => originalTransaction(async tx => work({
      ...tx,
      appendRequestLog: async () => { throw new Error('log insert failed'); },
    }));
    const settlement = new UsageSettlement({ repository });

    await expect(settlement.settle({
      userId: 3,
      reservedAmount: 4,
      chargeAmount: 1,
      requestId: 'req_rollback',
      successLog: { request_id: 'req_rollback', status: 'success' },
    })).rejects.toThrow('log insert failed');

    expect(repository.state.wallet).toEqual({ quota_balance: 8, gift_quota: 2, frozen_balance: 4, total_spent: 0 });
    expect(repository.state.transactions).toEqual([]);
    expect(repository.state.logs).toEqual([]);
  });

  it('keeps the reservation and records a pending-reconciliation log for uncertain execution', async () => {
    const repository = fakeSettlementRepository(
      { quota_balance: 8, gift_quota: 2, frozen_balance: 4, total_spent: 0 },
      { req_pending: { request_id: 'req_pending', user_id: 3, reserved_amount: 4, charged_amount: 0, status: 'reserved', result: {} } },
    );
    const settlement = new UsageSettlement({ repository });

    await settlement.markPending({
      userId: 3,
      reservedAmount: 4,
      requestId: 'req_pending',
      log: { request_id: 'req_pending', status: 'settlement_pending' },
    });

    expect(repository.state.wallet.frozen_balance).toBe(4);
    expect(repository.state.logs).toEqual([{ request_id: 'req_pending', status: 'settlement_pending', pending_reserved_amount: 4 }]);
  });

  it('automatically resolves a pending review at zero charge and updates the original log atomically', async () => {
    const repository = fakeSettlementRepository(
      { quota_balance: 8, gift_quota: 2, frozen_balance: 4, total_spent: 0 },
      { req_pending: { request_id: 'req_pending', user_id: 3, reserved_amount: 4, charged_amount: 0, status: 'pending_review', result: { pending: 4 } } },
    );
    repository.state.logs.push({
      id: 17, created_at: '2026-08-13 14:37:03.123456+08', request_id: 'req_pending', status: 'settlement_pending', pending_reserved_amount: 4,
      billing_snapshot: { reconciliation_reason: 'upstream_state_unknown' },
    });
    repository.state.logs.push({
      id: 18, created_at: '2026-08-13 14:38:00.000000+08', request_id: 'req_pending', status: 'failed',
      billing_snapshot: { unrelated: true },
    });
    const settlement = new UsageSettlement({ repository });

    const result = await settlement.resolvePending({
      userId: 3,
      reservedAmount: 4,
      chargeAmount: 0,
      requestId: 'req_pending',
      logIdentity: { id: 17, createdAt: '2026-08-13 14:37:03.123456+08' },
      logUpdates: {
        status: 'failed', error_type: 'upstream_state_unknown', error_message: 'Automatically reconciled without verifiable usage',
      },
      resultMetadata: { outcome: 'zero_released', reconciliation_source: 'worker' },
    });

    expect(result).toMatchObject({ charged: 0, released: 4, outcome: 'zero_released' });
    expect(repository.state.wallet).toMatchObject({ frozen_balance: 0, total_spent: 0 });
    expect(repository.state.reservations.req_pending).toMatchObject({ status: 'settled', charged_amount: 0 });
    expect(repository.state.logs[0]).toEqual(expect.objectContaining({
      request_id: 'req_pending', status: 'failed', total_cost: 0, pending_reserved_amount: 0,
      billing_snapshot: expect.objectContaining({
        settlement: expect.objectContaining({ outcome: 'zero_released', reconciliation_source: 'worker' }),
      }),
    }));
    expect(repository.state.logs[1]).toMatchObject({ id: 18, status: 'failed', billing_snapshot: { unrelated: true } });
  });
});

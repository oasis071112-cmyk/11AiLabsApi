import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, getDatabase } from '../src/database/init.js';
import { deductWalletBalance, releaseWalletReservation, reserveWalletBalance, settleWalletReservation, walletBalances } from '../src/utils/wallet-billing.js';
import { calculatePricing } from '../src/utils/pricing-engine.js';

process.env.DB_PATH = './data/test-proxy.db';

describe('扣费模块', () => {
  let userId;
  beforeAll(async () => {
    await initDatabase();
    const db = getDatabase();
    const exists = db.prepare("SELECT id FROM users WHERE username='billtest'").get();
    if (!exists) {
      db.prepare("INSERT INTO users (username,password_hash,role,status) VALUES (?,?,?,?)")
        .run('billtest', '$2a$10$dummy', 'user', 'active');
    }
    const user = db.prepare("SELECT id FROM users WHERE username='billtest'").get();
    userId = user.id;
    if (!db.prepare('SELECT id FROM wallets WHERE user_id=?').get(userId)) {
      db.prepare('INSERT INTO wallets (user_id,quota_balance,gift_quota) VALUES (?,0,0)').run(userId);
    }
  });

  it('应优先扣赠送额度再扣充值额度', () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=100, gift_quota=50, frozen_balance=0 WHERE user_id=?').run(userId);
    deductWalletBalance(db, userId, 80);
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
    expect(wallet.gift_quota).toBe(0);      // 50 赠送全扣
    expect(wallet.quota_balance).toBe(70);   // 剩余 30 从充值扣
  });

  it('额度不足应抛出异常', () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=5, gift_quota=0, frozen_balance=0 WHERE user_id=?').run(userId);
    expect(() => deductWalletBalance(db, userId, 100)).toThrow('额度不足');
  });

  it('新钱包余额为 0 时不能错误回退到旧字段余额', () => {
    expect(walletBalances({ quota_balance: 0, recharge_balance: 100, gift_quota: 0, gift_balance: 50, frozen_balance: 0 }))
      .toMatchObject({ quota: 0, gift: 0, available: 0 });
  });

  it('赠送额度足够时不应扣充值额度', () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=100, gift_quota=60, frozen_balance=0 WHERE user_id=?').run(userId);
    deductWalletBalance(db, userId, 40);
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
    expect(wallet.gift_quota).toBe(20);      // 只扣了40
    expect(wallet.quota_balance).toBe(100);  // 充值未动
  });

  it('扣费后累计消费应增加', () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=50, gift_quota=0, frozen_balance=0, total_spent=0 WHERE user_id=?').run(userId);
    deductWalletBalance(db, userId, 30);
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
    expect(wallet.quota_balance).toBe(20);
    expect(wallet.total_spent).toBe(30);
  });

  it('成功扣点必须同时生成可追溯的消费流水', () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=100, gift_quota=20, frozen_balance=0, total_spent=0 WHERE user_id=?').run(userId);
    const requestId = 'req_wallet_charge_test';
    db.prepare('DELETE FROM wallet_transactions WHERE user_id=? AND related_request_id=?').run(userId, requestId);
    const result = deductWalletBalance(db, userId, 35, requestId);
    const wallet = db.prepare('SELECT quota_balance,gift_quota,total_spent FROM wallets WHERE user_id=?').get(userId);
    const transactions = db.prepare("SELECT amount,related_request_id FROM wallet_transactions WHERE user_id=? AND related_request_id=? ORDER BY id DESC").all(userId, requestId);
    expect(result).toEqual({ charged: 35, giftCharged: 20, quotaCharged: 15 });
    expect(wallet).toMatchObject({ quota_balance: 85, gift_quota: 0, total_spent: 35 });
    expect(transactions).toHaveLength(2);
    expect(transactions.every(t => t.related_request_id === requestId)).toBe(true);
  });

  it('官方美元价格乘汇率和用户倍率后，必须按计算出的点数扣钱包', () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=500, gift_quota=0, frozen_balance=0, total_spent=0 WHERE user_id=?').run(userId);
    const pricing = calculatePricing({
      inputTokens: 1_000_000, outputTokens: 2_000_000,
      official: { currency: 'USD', input: 5, output: 30, unitTokens: 1_000_000 },
      multipliers: { input: 0.88, output: 0.88 }, usdCnyRate: 7,
    });
    deductWalletBalance(db, userId, pricing.userCostPoints, 'req_pricing_wallet_test');
    const wallet = db.prepare('SELECT quota_balance,total_spent FROM wallets WHERE user_id=?').get(userId);
    expect(pricing.userCostPoints).toBeCloseTo(400.4, 8);
    expect(wallet.quota_balance).toBeCloseTo(99.6, 8);
    expect(wallet.total_spent).toBeCloseTo(400.4, 8);
  });

  it('上游调用前冻结全额可用余额，结算、扣点和成功日志在同一事务完成', () => {
    const db = getDatabase();
    const requestId = 'req_reserved_settlement_test';
    db.prepare('DELETE FROM api_request_logs WHERE request_id=?').run(requestId);
    db.prepare('UPDATE wallets SET quota_balance=100, gift_quota=20, frozen_balance=0, total_spent=0 WHERE user_id=?').run(userId);
    reserveWalletBalance(db, userId, 120, requestId);
    expect(db.prepare('SELECT frozen_balance FROM wallets WHERE user_id=?').get(userId).frozen_balance).toBe(120);

    settleWalletReservation(db, {
      userId, reservedAmount: 120, chargeAmount: 35, requestId,
      writeSuccessLog: () => db.prepare("INSERT INTO api_request_logs (request_id,user_id,model_code,status,total_cost) VALUES (?,?,'gpt-test','success',?)").run(requestId, userId, 35),
    });
    const wallet = db.prepare('SELECT quota_balance,gift_quota,frozen_balance,total_spent FROM wallets WHERE user_id=?').get(userId);
    const log = db.prepare('SELECT status,total_cost FROM api_request_logs WHERE request_id=?').get(requestId);
    expect(wallet).toMatchObject({ quota_balance: 85, gift_quota: 0, frozen_balance: 0, total_spent: 35 });
    expect(log).toMatchObject({ status: 'success', total_cost: 35 });
  });

  it('上游失败时必须释放冻结额度，不能把用户余额卡住', () => {
    const db = getDatabase();
    const requestId = 'req_reserved_release_test';
    db.prepare('UPDATE wallets SET quota_balance=50, gift_quota=0, frozen_balance=0 WHERE user_id=?').run(userId);
    reserveWalletBalance(db, userId, 50, requestId);
    releaseWalletReservation(db, userId, 50, requestId);
    const wallet = db.prepare('SELECT quota_balance,gift_quota,frozen_balance FROM wallets WHERE user_id=?').get(userId);
    expect(wallet).toMatchObject({ quota_balance: 50, gift_quota: 0, frozen_balance: 0 });
  });

  it('真实费用意外超过冻结额时必须精确记为欠费，不能免费调用', () => {
    const db = getDatabase();
    const requestId = 'req_reserved_overage_test';
    db.prepare('DELETE FROM api_request_logs WHERE request_id=?').run(requestId);
    db.prepare('UPDATE wallets SET quota_balance=10, gift_quota=0, frozen_balance=0, total_spent=0 WHERE user_id=?').run(userId);
    reserveWalletBalance(db, userId, 10, requestId);
    const result = settleWalletReservation(db, {
      userId, reservedAmount: 10, chargeAmount: 12.5, requestId,
      writeSuccessLog: () => db.prepare("INSERT INTO api_request_logs (request_id,user_id,model_code,status,total_cost) VALUES (?,?,'gpt-test','success',?)").run(requestId, userId, 12.5),
    });
    const wallet = db.prepare('SELECT quota_balance,frozen_balance,total_spent FROM wallets WHERE user_id=?').get(userId);
    expect(result.debtCreated).toBeCloseTo(2.5, 8);
    expect(wallet).toMatchObject({ quota_balance: -2.5, frozen_balance: 0, total_spent: 12.5 });
  });

  it('余额扣至 0 后重启不能从已停用的旧字段恢复点数', async () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=0, gift_quota=0, recharge_balance=100, gift_balance=50, frozen_balance=0 WHERE user_id=?').run(userId);
    await initDatabase();
    const wallet = getDatabase().prepare('SELECT quota_balance,gift_quota FROM wallets WHERE user_id=?').get(userId);
    expect(wallet).toMatchObject({ quota_balance: 0, gift_quota: 0 });
  });
});

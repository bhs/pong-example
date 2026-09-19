'use strict';

/**
 * __tests__/gameHistoryService.test.js
 *
 * Unit tests for GameHistoryService (and, transitively, the repository it
 * sits on) against the in-memory fake Prisma client — no real MySQL
 * instance required.
 */

const { createGameHistoryService } = require('../lib/gameHistoryService');
const { createFakePrisma } = require('./helpers/fakePrisma');

const ALICE = 'google-sub-alice';
const BOB   = 'google-sub-bob';

describe('GameHistoryService.recordGame', () => {
  let prisma, service;

  beforeEach(() => {
    prisma  = createFakePrisma();
    service = createGameHistoryService(prisma);
  });

  test('inserts a GameHistory row', async () => {
    await service.recordGame({ player: ALICE, score: 7, duration: 120 });
    expect(prisma.__gameHistory).toHaveLength(1);
    expect(prisma.__gameHistory[0]).toMatchObject({ player: ALICE, score: 7, duration: 120 });
  });

  test('stamps finishedAt with the current time', async () => {
    const before = Date.now();
    await service.recordGame({ player: ALICE, score: 3, duration: 60 });
    const after = Date.now();
    const row = prisma.__gameHistory[0];
    expect(row.finishedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.finishedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test('records every game, not just personal bests', async () => {
    await service.recordGame({ player: ALICE, score: 10, duration: 90 });
    await service.recordGame({ player: ALICE, score: 2,  duration: 30 });
    expect(prisma.__gameHistory).toHaveLength(2);
  });
});

describe('GameHistoryService.getSummary', () => {
  let prisma, service;

  beforeEach(() => {
    prisma  = createFakePrisma();
    service = createGameHistoryService(prisma);
  });

  test('returns null highScore and empty recentGames for an unknown player', async () => {
    const summary = await service.getSummary(ALICE);
    expect(summary.highScore).toBeNull();
    expect(summary.recentGames).toEqual([]);
  });

  test('returns the stored high score alongside recent games', async () => {
    prisma.__highScores.set(ALICE, { id: 1, userId: ALICE, score: 42, updatedAt: new Date() });
    await service.recordGame({ player: ALICE, score: 10, duration: 30 });

    const summary = await service.getSummary(ALICE);
    expect(summary.highScore.score).toBe(42);
    expect(summary.recentGames).toHaveLength(1);
    expect(summary.recentGames[0].score).toBe(10);
  });

  test('orders recentGames newest first', async () => {
    await service.recordGame({ player: ALICE, score: 1, duration: 10 });
    await new Promise((r) => setTimeout(r, 5));
    await service.recordGame({ player: ALICE, score: 2, duration: 20 });

    const summary = await service.getSummary(ALICE);
    expect(summary.recentGames[0].score).toBe(2);
    expect(summary.recentGames[1].score).toBe(1);
  });

  test('caps recentGames at the default limit of 10', async () => {
    for (let i = 0; i < 15; i++) {
      await service.recordGame({ player: ALICE, score: i, duration: 10 });
    }
    const summary = await service.getSummary(ALICE);
    expect(summary.recentGames).toHaveLength(10);
  });

  test('respects a custom historyLimit', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordGame({ player: ALICE, score: i, duration: 10 });
    }
    const summary = await service.getSummary(ALICE, { historyLimit: 2 });
    expect(summary.recentGames).toHaveLength(2);
  });

  test('only returns games for the requested player', async () => {
    await service.recordGame({ player: ALICE, score: 1, duration: 10 });
    await service.recordGame({ player: BOB,   score: 2, duration: 20 });

    const summary = await service.getSummary(ALICE);
    expect(summary.recentGames).toHaveLength(1);
    expect(summary.recentGames[0].score).toBe(1);
  });
});

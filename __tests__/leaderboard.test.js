'use strict';

/**
 * __tests__/leaderboard.test.js
 *
 * The global leaderboard: GET /api/scores ranking (order, tie-breaks, rank
 * field, default limit), the placement option's own code, and the modal's
 * rendering in index.html (its pure body renderer is lifted out of the page
 * and run directly; the rest is source assertions, like the other UI tests).
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const http = require('http');

const { createApp } = require('../server');
const { createFakePrisma } = require('./helpers/fakePrisma');
const modalFromAButton = require('../lib/leaderboard-placements/modal-from-a-button');
const { leaderboardConfig, DEFAULT_PLACEMENT } = require('../lib/leaderboard-placement');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function getJson(app, url) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) });
        });
      }).on('error', (err) => { server.close(); reject(err); });
    });
  });
}

function addScore(prisma, userId, score, longestRally, updatedAt, name) {
  prisma.__users.set(userId, { id: userId, name: name || userId, email: null, nickname: null });
  prisma.__highScores.set(userId, {
    id: prisma.__highScores.size + 1, userId, score, longestRally, updatedAt: new Date(updatedAt),
  });
}

describe('GET /api/scores leaderboard ranking', () => {
  let prisma, app;
  beforeEach(() => {
    prisma = createFakePrisma();
    app = createApp(prisma, { logWrite: () => {} });
  });

  test('orders by score descending and assigns 1-based ranks', async () => {
    addScore(prisma, 'a', 5, 3, 1000);
    addScore(prisma, 'b', 9, 3, 2000);
    addScore(prisma, 'c', 7, 3, 3000);
    const res = await getJson(app, '/api/scores');
    expect(res.body.scores.map((e) => [e.userId, e.rank, e.score])).toEqual([
      ['b', 1, 9], ['c', 2, 7], ['a', 3, 5],
    ]);
  });

  test('breaks score ties by longest rally, then by who got there first', async () => {
    addScore(prisma, 'slow',  8, 10, 5000);
    addScore(prisma, 'quick', 8, 10, 1000);
    addScore(prisma, 'rally', 8, 20, 9000);
    addScore(prisma, 'low',   3, 99, 100);
    const res = await getJson(app, '/api/scores');
    expect(res.body.scores.map((e) => e.userId)).toEqual(['rally', 'quick', 'slow', 'low']);
    expect(res.body.scores.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
  });

  test('keeps the existing fields on every entry', async () => {
    addScore(prisma, 'a', 5, 4, 1000, 'Ann');
    const [entry] = (await getJson(app, '/api/scores')).body.scores;
    expect(entry).toMatchObject({ player: 'Ann', userId: 'a', score: 5, longestRally: 4, rank: 1 });
    expect(entry).toHaveProperty('updatedAt');
    expect(entry).toHaveProperty('lastPlayedAt');
  });

  test('defaults to the top 10 when no limit is given', async () => {
    for (let i = 0; i < 15; i++) addScore(prisma, `p${i}`, i, 0, 1000 + i);
    const res = await getJson(app, '/api/scores');
    expect(res.body.scores).toHaveLength(10);
    expect(res.body.scores[0].score).toBe(14);
    expect(res.body.scores[9].rank).toBe(10);
  });

  test('still honours an explicit limit, capped at 100, and ignores a non-positive one', async () => {
    for (let i = 0; i < 15; i++) addScore(prisma, `p${i}`, i, 0, 1000 + i);
    expect((await getJson(app, '/api/scores?limit=3')).body.scores).toHaveLength(3);
    expect((await getJson(app, '/api/scores?limit=500')).body.scores).toHaveLength(15);
    expect((await getJson(app, '/api/scores?limit=-4')).body.scores).toHaveLength(10);
  });

  test('is public and empty-safe', async () => {
    const res = await getJson(app, '/api/scores?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.scores).toEqual([]);
  });
});

describe('fakePrisma array orderBy', () => {
  test('sorts by several keys, later keys only breaking ties', async () => {
    const prisma = createFakePrisma();
    addScore(prisma, 'a', 1, 5, 2000);
    addScore(prisma, 'b', 1, 5, 1000);
    addScore(prisma, 'c', 2, 0, 3000);
    const rows = await prisma.highScore.findMany({
      orderBy: [{ score: 'desc' }, { longestRally: 'desc' }, { updatedAt: 'asc' }],
    });
    expect(rows.map((r) => r.userId)).toEqual(['c', 'b', 'a']);
  });
});

describe('modal-from-a-button option', () => {
  test('its own code describes a top-10 modal', () => {
    expect(modalFromAButton.clientConfig()).toEqual({ placement: 'modal-from-a-button', limit: 10 });
  });

  test('is what the dispatch yields with nothing set, and GET /api/config serves it', async () => {
    expect(DEFAULT_PLACEMENT).toBe('modal-from-a-button');
    expect(leaderboardConfig({})).toEqual(modalFromAButton.clientConfig());
    const app = createApp(createFakePrisma(), { logWrite: () => {} });
    const res = await getJson(app, '/api/config');
    expect(res.status).toBe(200);
    expect(res.body.leaderboard.placement).toBe('modal-from-a-button');
  });
});

describe('leaderboard modal in index.html', () => {
  const fn = (name) => {
    const m = html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n    \\}\\n`));
    if (!m) throw new Error(`function ${name} not found`);
    return m[0];
  };
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${fn('escapeHtml')}\n${fn('renderLeaderboardBody')}`, ctx);
  const render = (state, me) => ctx.renderLeaderboardBody(state, me);

  const scores = [
    { rank: 1, userId: 'u1', player: 'Ann', score: 11, longestRally: 21 },
    { rank: 2, userId: 'u2', player: 'Bo',  score: 9,  longestRally: 7 },
  ];

  test('has a trophy button in the auth bar for both signed-in and signed-out states', () => {
    expect(html).toMatch(/btn\.id = 'pong-leaderboard-btn';/);
    expect(fn('renderSignedOut')).toMatch(/appendLeaderboardButton\(bar\);/);
    expect(fn('renderSignedIn')).toMatch(/appendLeaderboardButton\(bar\);/);
  });

  test('fetches the top 10 afresh every time it opens', () => {
    expect(fn('loadLeaderboardInto')).toMatch(/fetch\(`\/api\/scores\?limit=\$\{encodeURIComponent\(leaderboardConfig\.limit\)\}`/);
    expect(fn('openLeaderboardModal')).toMatch(/loadLeaderboardInto\(body\);/);
    expect(html).toMatch(/limit: 10 \}/);
  });

  test('shows loading, empty and error states', () => {
    expect(render({ status: 'loading' }, null)).toMatch(/Loading leaderboard/);
    expect(render({ status: 'ready', scores: [] }, null)).toMatch(/No scores yet/);
    expect(render({ status: 'error' }, null)).toMatch(/Could not load the leaderboard/);
  });

  test('lists rank, player, score and longest rally', () => {
    const out = render({ status: 'ready', scores }, null);
    expect(out).toMatch(/<th>Score<\/th>/);
    expect(out).toMatch(/<th>Longest rally<\/th>/);
    expect(out).toMatch(/<td class="pong-lb-rank">1<\/td><td class="pong-lb-player">Ann<\/td><td>11<\/td><td>21<\/td>/);
  });

  test('highlights only the signed-in player\'s row', () => {
    const out = render({ status: 'ready', scores }, 'u2');
    expect(out.match(/pong-lb-me/g)).toHaveLength(1);
    expect(out).toMatch(/pong-lb-me"><td class="pong-lb-rank">2<\/td><td class="pong-lb-player">Bo \(you\)/);
    expect(out).not.toMatch(/get on the board/);
  });

  test('anonymous visitors see the full board plus a sign-in link, with no highlight', () => {
    const out = render({ status: 'ready', scores }, null);
    expect(out).not.toMatch(/pong-lb-me/);
    expect(out).toMatch(/<a id="pong-lb-signin" href="\/auth\/google">Sign in with Google to get on the board<\/a>/);
  });

  test('tells a signed-in player who is not on the board how to get on it', () => {
    expect(render({ status: 'ready', scores }, 'someone-else')).toMatch(/Finish a game/);
  });

  test('escapes player names', () => {
    const evil = [{ rank: 1, userId: 'x', player: '<img src=x onerror=alert(1)>"&', score: 1, longestRally: 0 }];
    const out = render({ status: 'ready', scores: evil }, null);
    expect(out).not.toMatch(/<img/);
    expect(out).toMatch(/&lt;img src=x onerror=alert\(1\)&gt;&quot;&amp;/);
  });
});

describe('game-over-overlay-section option', () => {
  const gameOverOverlaySection = require('../lib/leaderboard-placements/game-over-overlay-section');
  const fn = (name) => {
    const m = html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n    \\}\\n`));
    if (!m) throw new Error(`function ${name} not found`);
    return m[0];
  };
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${fn('escapeHtml')}\n${fn('renderOverlayLeaderboard')}`, ctx);
  const render = (state, me) => ctx.renderOverlayLeaderboard(state, me);

  const scores = [
    { rank: 1, userId: 'u1', player: 'Ann', score: 11, longestRally: 21 },
    { rank: 2, userId: 'u2', player: 'Bo',  score: 9,  longestRally: 7 },
  ];

  test('its own code describes a compact top-5 list', () => {
    expect(gameOverOverlaySection.clientConfig()).toEqual({ placement: 'game-over-overlay-section', limit: 5 });
  });

  test('renders loading, empty and error states', () => {
    expect(render({ status: 'loading' }, null)).toMatch(/Loading/);
    expect(render({ status: 'ready', scores: [] }, null)).toMatch(/No scores yet/);
    expect(render({ status: 'error' }, null)).toMatch(/unavailable/);
  });

  test('lists rank, player and score, highlighting only the signed-in player', () => {
    const out = render({ status: 'ready', scores }, 'u2');
    expect(out).toMatch(/<td class="overlay-lb-rank">1<\/td><td class="overlay-lb-player">Ann<\/td><td>11<\/td>/);
    expect(out.match(/overlay-lb-me/g)).toHaveLength(1);
    expect(out).toMatch(/overlay-lb-me"><td class="overlay-lb-rank">2<\/td><td class="overlay-lb-player">Bo \(you\)/);
    expect(render({ status: 'ready', scores }, null)).not.toMatch(/overlay-lb-me/);
  });

  test('escapes player names', () => {
    const evil = [{ rank: 1, userId: 'x', player: '<img src=x onerror=alert(1)>', score: 1 }];
    expect(render({ status: 'ready', scores: evil }, null)).not.toMatch(/<img/);
  });

  test('is fetched with the configured limit only after the score POST resolves', () => {
    const badge = fn('renderPersonalBestBadge');
    expect(badge.indexOf("method: 'POST'")).toBeGreaterThan(-1);
    expect(badge.indexOf('refreshOverlayLeaderboard(overlay, user.id)')).toBeGreaterThan(badge.indexOf("method: 'POST'"));
    expect(fn('refreshOverlayLeaderboard')).toMatch(/fetch\(`\/api\/scores\?limit=\$\{encodeURIComponent\(leaderboardConfig\.limit\)\}`/);
    expect(fn('refreshOverlayLeaderboard')).toMatch(/placement !== 'game-over-overlay-section'\) return;/);
  });
});

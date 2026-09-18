'use strict';

const {
  CANVAS_H,
  PADDLE_H,
  SCORE_WIN,
  makePlayerPaddle,
  makeAiPaddle,
  makeGame,
  makeRally,
  makeSettings,
  resetGame,
} = require('../game-logic');

// ── makeSettings ─────────────────────────────────────────────────────────

describe('makeSettings', () => {
  test('returns sensible defaults', () => {
    const s = makeSettings();
    expect(s.paddleColor).toBe('#ffffff');
    expect(s.canvasTheme).toBe('#000000');
    expect(s.difficulty).toBe('normal');
  });

  test('accepts partial overrides without dropping other defaults', () => {
    const s = makeSettings({ difficulty: 'hard' });
    expect(s.difficulty).toBe('hard');
    expect(s.paddleColor).toBe('#ffffff');
    expect(s.canvasTheme).toBe('#000000');
  });

  test('two calls return independent objects', () => {
    const a = makeSettings();
    const b = makeSettings();
    a.paddleColor = '#ff0000';
    expect(b.paddleColor).toBe('#ffffff');
  });
});

// ── resetGame ─────────────────────────────────────────────────────────────

describe('resetGame', () => {
  function makeDirtyState() {
    const playerPaddle = makePlayerPaddle();
    const aiPaddle      = makeAiPaddle();
    const game          = makeGame();
    const rally         = makeRally();

    // Simulate a match in progress / just finished
    playerPaddle.y     = 12;
    playerPaddle.score = 5;
    aiPaddle.y         = 400;
    aiPaddle.score     = SCORE_WIN;
    game.phase         = 'won';
    game.winner        = 'ai';
    game.pauseTimer    = -3;
    rally.rallyCount   = 9;
    rally.flashFrames  = 2;

    return { playerPaddle, aiPaddle, game, rally };
  }

  test('re-centres both paddles', () => {
    const { playerPaddle, aiPaddle, game, rally } = makeDirtyState();
    resetGame(playerPaddle, aiPaddle, game, rally);
    expect(playerPaddle.y).toBeCloseTo(CANVAS_H / 2 - PADDLE_H / 2);
    expect(aiPaddle.y).toBeCloseTo(CANVAS_H / 2 - PADDLE_H / 2);
  });

  test('zeroes both scores', () => {
    const { playerPaddle, aiPaddle, game, rally } = makeDirtyState();
    resetGame(playerPaddle, aiPaddle, game, rally);
    expect(playerPaddle.score).toBe(0);
    expect(aiPaddle.score).toBe(0);
  });

  test('clears the winner and returns to the scored phase', () => {
    const { playerPaddle, aiPaddle, game, rally } = makeDirtyState();
    resetGame(playerPaddle, aiPaddle, game, rally);
    expect(game.winner).toBeNull();
    expect(game.phase).toBe('scored');
    expect(game.pauseTimer).toBeGreaterThan(0);
  });

  test('resets rally state (rallyCount and flashFrames)', () => {
    const { playerPaddle, aiPaddle, game, rally } = makeDirtyState();
    resetGame(playerPaddle, aiPaddle, game, rally);
    expect(rally.rallyCount).toBe(0);
    expect(rally.flashFrames).toBe(0);
  });

  test('works without a rally argument (does not throw)', () => {
    const { playerPaddle, aiPaddle, game } = makeDirtyState();
    expect(() => resetGame(playerPaddle, aiPaddle, game)).not.toThrow();
  });

  test('does NOT accept or touch a settings object — preferences persist across restarts', () => {
    const { playerPaddle, aiPaddle, game, rally } = makeDirtyState();
    const settings = makeSettings({ paddleColor: '#ff00ff', difficulty: 'hard', canvasTheme: '#123456' });
    const settingsBefore = { ...settings };

    resetGame(playerPaddle, aiPaddle, game, rally);

    expect(settings).toEqual(settingsBefore);
  });

  test('is idempotent — calling twice yields the same clean state', () => {
    const { playerPaddle, aiPaddle, game, rally } = makeDirtyState();
    resetGame(playerPaddle, aiPaddle, game, rally);
    const snapshot = JSON.stringify({ playerPaddle, aiPaddle, game, rally });
    resetGame(playerPaddle, aiPaddle, game, rally);
    expect(JSON.stringify({ playerPaddle, aiPaddle, game, rally })).toBe(snapshot);
  });
});

// ── index.html wiring for the state-reset-function variation ─────────────

describe('index.html — state-reset-function variation', () => {
  const fs   = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  /**
   * Extract the full body of `function <name>(...) { ... }` by brace
   * counting, so nested blocks (if/for/etc.) inside the function don't
   * confuse a naive regex into stopping at the first inner closing brace.
   */
  function extractFunctionBody(source, name) {
    const startMatch = source.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`));
    if (!startMatch) return null;
    const openBraceIndex = startMatch.index + startMatch[0].length - 1;
    let depth = 0;
    for (let i = openBraceIndex; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) return source.slice(openBraceIndex + 1, i);
      }
    }
    return null;
  }

  test('defines a single resetGame() function', () => {
    expect(html).toMatch(/function resetGame\s*\(/);
  });

  test('defines a settings object separate from game state', () => {
    expect(html).toMatch(/const settings\s*=\s*\{/);
  });

  test('settings includes paddle colour, canvas theme and difficulty', () => {
    expect(html).toMatch(/paddleColor/);
    expect(html).toMatch(/canvasTheme/);
    expect(html).toMatch(/difficulty/);
  });

  test('resetGame() does not assign to or read from settings', () => {
    const body = extractFunctionBody(html, 'resetGame');
    expect(body).not.toBeNull();
    expect(body).not.toMatch(/settings\s*\./);
    expect(body).not.toMatch(/settings\s*=/);
  });

  test('Play Again / Space restart flow calls resetGame() then requestAnimationFrame(loop)', () => {
    const body = extractFunctionBody(html, 'startNewGame');
    expect(body).not.toBeNull();
    expect(body).toMatch(/resetGame\s*\(\s*\)/);
    expect(body).toMatch(/requestAnimationFrame\s*\(\s*loop\s*\)/);
  });
});


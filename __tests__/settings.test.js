'use strict';

const {
  BALL_SPEED_INIT,
  BALL_SPEED_MAX,
  AI_LERP,
  AI_LERP_RALLY_INC,
  MAX_DEFLECT_ANGLE,
  PADDLE_SKINS,
  BALL_SPEED_PRESETS,
  DIFFICULTY_PRESETS,
  DEFAULT_SETTINGS,
  normalizeSettings,
  resolveBallSpeeds,
  resolveDifficulty,
  resolvePaddleFill,
  deflectAngle,
} = require('../game-logic');

// ── normalizeSettings ────────────────────────────────────────────────────

describe('normalizeSettings', () => {
  test('returns defaults when given null/undefined', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  test('returns defaults when given a non-object', () => {
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  test('passes through valid values unchanged', () => {
    const raw = { paddleSkin: 'neon', ballSpeed: 'fast', difficulty: 'hard' };
    expect(normalizeSettings(raw)).toEqual(raw);
  });

  test('falls back to defaults for unrecognised individual keys', () => {
    const raw = { paddleSkin: 'glitter', ballSpeed: 'fast', difficulty: 'nightmare' };
    expect(normalizeSettings(raw)).toEqual({
      paddleSkin: DEFAULT_SETTINGS.paddleSkin,
      ballSpeed:  'fast',
      difficulty: DEFAULT_SETTINGS.difficulty,
    });
  });

  test('falls back to defaults when keys are missing entirely', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  test('is resilient to prototype-polluting-looking keys', () => {
    expect(normalizeSettings({ paddleSkin: '__proto__' })).toEqual(DEFAULT_SETTINGS);
  });
});

// ── resolveBallSpeeds ────────────────────────────────────────────────────

describe('resolveBallSpeeds', () => {
  test('normal preset matches the base constants exactly', () => {
    const speeds = resolveBallSpeeds({ ballSpeed: 'normal' });
    expect(speeds.initSpeed).toBe(BALL_SPEED_INIT);
    expect(speeds.maxSpeed).toBe(BALL_SPEED_MAX);
  });

  test('slow preset scales both init and max speed down', () => {
    const speeds = resolveBallSpeeds({ ballSpeed: 'slow' });
    expect(speeds.initSpeed).toBeCloseTo(BALL_SPEED_INIT * BALL_SPEED_PRESETS.slow.multiplier);
    expect(speeds.maxSpeed).toBeCloseTo(BALL_SPEED_MAX * BALL_SPEED_PRESETS.slow.multiplier);
    expect(speeds.initSpeed).toBeLessThan(BALL_SPEED_INIT);
  });

  test('fast preset scales both init and max speed up', () => {
    const speeds = resolveBallSpeeds({ ballSpeed: 'fast' });
    expect(speeds.initSpeed).toBeGreaterThan(BALL_SPEED_INIT);
    expect(speeds.maxSpeed).toBeGreaterThan(BALL_SPEED_MAX);
  });

  test('falls back to the normal preset for an unrecognised value', () => {
    const speeds = resolveBallSpeeds({ ballSpeed: 'ludicrous' });
    expect(speeds.initSpeed).toBe(BALL_SPEED_INIT);
    expect(speeds.maxSpeed).toBe(BALL_SPEED_MAX);
  });

  test('falls back to the normal preset when settings is undefined', () => {
    const speeds = resolveBallSpeeds(undefined);
    expect(speeds.initSpeed).toBe(BALL_SPEED_INIT);
  });
});

// ── resolveDifficulty ────────────────────────────────────────────────────

describe('resolveDifficulty', () => {
  test('normal preset matches the base AI constants exactly', () => {
    const diff = resolveDifficulty({ difficulty: 'normal' });
    expect(diff.aiLerp).toBe(AI_LERP);
    expect(diff.aiLerpRallyInc).toBe(AI_LERP_RALLY_INC);
    expect(diff.maxDeflectAngle).toBe(MAX_DEFLECT_ANGLE);
  });

  test('easy preset is less aggressive than normal', () => {
    const easy = resolveDifficulty({ difficulty: 'easy' });
    const normal = resolveDifficulty({ difficulty: 'normal' });
    expect(easy.aiLerp).toBeLessThan(normal.aiLerp);
    expect(easy.aiLerpRallyInc).toBeLessThan(normal.aiLerpRallyInc);
    expect(easy.maxDeflectAngle).toBeLessThan(normal.maxDeflectAngle);
  });

  test('hard preset is more aggressive than normal', () => {
    const hard = resolveDifficulty({ difficulty: 'hard' });
    const normal = resolveDifficulty({ difficulty: 'normal' });
    expect(hard.aiLerp).toBeGreaterThan(normal.aiLerp);
    expect(hard.aiLerpRallyInc).toBeGreaterThan(normal.aiLerpRallyInc);
    expect(hard.maxDeflectAngle).toBeGreaterThan(normal.maxDeflectAngle);
  });

  test('falls back to the normal preset for an unrecognised value', () => {
    const diff = resolveDifficulty({ difficulty: 'impossible' });
    expect(diff).toEqual(resolveDifficulty({ difficulty: 'normal' }));
  });
});

// ── resolvePaddleFill ────────────────────────────────────────────────────

describe('resolvePaddleFill', () => {
  test('returns the fill colour for each known skin', () => {
    Object.keys(PADDLE_SKINS).forEach((key) => {
      expect(resolvePaddleFill({ paddleSkin: key })).toBe(PADDLE_SKINS[key].fill);
    });
  });

  test('falls back to the classic skin for an unrecognised value', () => {
    expect(resolvePaddleFill({ paddleSkin: 'invisible' })).toBe(PADDLE_SKINS.classic.fill);
  });
});

// ── deflectAngle with a custom max angle (difficulty integration) ───────

describe('deflectAngle with a custom maxAngle', () => {
  test('defaults to MAX_DEFLECT_ANGLE when no maxAngle is supplied', () => {
    expect(deflectAngle(40)).toBeCloseTo(deflectAngle(40, MAX_DEFLECT_ANGLE));
  });

  test('scales the deflection with the supplied maxAngle at the paddle edge', () => {
    const easyMax = DIFFICULTY_PRESETS.easy.maxDeflectAngle;
    const hardMax = DIFFICULTY_PRESETS.hard.maxDeflectAngle;
    // relY at the extreme edge of the paddle (PADDLE_H / 2 = 40) should hit
    // exactly maxAngle in magnitude, regardless of which preset supplies it.
    expect(deflectAngle(40, easyMax)).toBeCloseTo(easyMax);
    expect(deflectAngle(-40, hardMax)).toBeCloseTo(-hardMax);
  });
});

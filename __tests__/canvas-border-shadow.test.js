'use strict';

/**
 * __tests__/canvas-border-shadow.test.js
 *
 * Smoke tests for the rounded-corner + drop-shadow styling applied directly
 * to the <canvas> element in index.html. Purely declarative CSS living in
 * the <style> block (no JS/markup changes), so these tests assert against
 * the raw file contents rather than spinning up a DOM/browser environment.
 */

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('canvas border/shadow styling', () => {
  test('defines a rounded border-radius on the canvas rule', () => {
    const styleMatch = html.match(/canvas\s*\{([^}]*)\}/);
    expect(styleMatch).not.toBeNull();
    const rules = styleMatch[1];
    expect(rules).toMatch(/border-radius:\s*12px/);
  });

  test('defines a soft drop shadow on the canvas rule', () => {
    const styleMatch = html.match(/canvas\s*\{([^}]*)\}/);
    expect(styleMatch).not.toBeNull();
    const rules = styleMatch[1];
    expect(rules).toMatch(/box-shadow:\s*0\s+8px\s+24px\s+rgba\(0,\s*0,\s*0,\s*0\.35\)/);
  });

  test('defines a subtle 1px border to define the canvas edge', () => {
    const styleMatch = html.match(/canvas\s*\{([^}]*)\}/);
    expect(styleMatch).not.toBeNull();
    const rules = styleMatch[1];
    expect(rules).toMatch(/border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.08\)/);
  });

  test('canvas element itself carries no inline style overriding the shared rule', () => {
    const tagMatch = html.match(/<canvas id="gameCanvas"[^>]*>/);
    expect(tagMatch).not.toBeNull();
    expect(tagMatch[0]).not.toMatch(/style="/);
  });
});

'use strict';

/**
 * __tests__/control-hint-copy-check.test.js
 *
 * Checks two independent things about the static control-hints caption in
 * index.html:
 *
 *  1. Copy accuracy — the caption text must describe the *actual* key
 *     bindings wired up in the keydown handler / update loop, not a stale
 *     description of some earlier control scheme.
 *
 *  2. Legibility — the muted caption color must retain at least WCAG AA
 *     contrast (4.5:1) against both the page background and the canvas
 *     background, and the font-size must not be smaller than the
 *     neighboring "Best rally" caption (i.e. it isn't the smallest text
 *     on the page).
 *
 * Both checks run against the raw file contents, mirroring the existing
 * control-hints/canvas-border-shadow smoke tests (no DOM/browser needed).
 */

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/** WCAG relative luminance for a #rrggbb / #rgb hex color. */
function relativeLuminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [r, g, b].map(lin);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio between two #rrggbb / #rgb hex colors. */
function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker  = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('control hint copy-and-legibility pass', () => {
  test('key bindings referenced by the caption match the handlers actually wired up', () => {
    const captionMatch = html.match(/<p id="pong-control-hints">([^<]*)<\/p>/);
    expect(captionMatch).not.toBeNull();
    const copy = captionMatch[1];

    // Movement: caption claims W/S and arrow keys move the paddle.
    expect(copy).toMatch(/W\/S/);
    expect(copy).toMatch(/↑\/↓/);
    expect(html).toMatch(/keys\['KeyW'\]/);
    expect(html).toMatch(/keys\['KeyS'\]/);
    expect(html).toMatch(/keys\['ArrowUp'\]/);
    expect(html).toMatch(/keys\['ArrowDown'\]/);

    // Restart: caption claims Space restarts from the game-over screen.
    expect(copy).toMatch(/Space to play again/);
    expect(html).toMatch(/e\.code === 'Space' && game\.phase === 'gameover'/);
  });

  test('caption color retains at least AA contrast (4.5:1) against page and canvas backgrounds', () => {
    const styleMatch = html.match(/#pong-control-hints\s*\{([^}]*)\}/);
    expect(styleMatch).not.toBeNull();
    const colorMatch = styleMatch[1].match(/color:\s*(#[0-9a-fA-F]{3,6})/);
    expect(colorMatch).not.toBeNull();
    const hintColor = colorMatch[1];

    const bodyBgMatch = html.match(/html,\s*body\s*\{([^}]*)\}/);
    const canvasBgMatch = html.match(/canvas\s*\{([^}]*)\}/);
    expect(bodyBgMatch).not.toBeNull();
    expect(canvasBgMatch).not.toBeNull();

    const bodyBg   = bodyBgMatch[1].match(/background:\s*(#[0-9a-fA-F]{3,6})/)[1];
    const canvasBg = canvasBgMatch[1].match(/background:\s*(#[0-9a-fA-F]{3,6})/)[1];

    expect(contrastRatio(hintColor, bodyBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hintColor, canvasBg)).toBeGreaterThanOrEqual(4.5);
  });

  test('caption font-size is not smaller than the neighboring best-rally caption', () => {
    const hintStyle = html.match(/#pong-control-hints\s*\{([^}]*)\}/)[1];
    const rallyStyle = html.match(/#pong-best-rally\s*\{([^}]*)\}/)[1];

    const hintSize  = parseFloat(hintStyle.match(/font-size:\s*([\d.]+)rem/)[1]);
    const rallySize = parseFloat(rallyStyle.match(/font-size:\s*([\d.]+)rem/)[1]);

    expect(hintSize).toBeGreaterThanOrEqual(rallySize);
  });

  test('caption remains a single unobtrusive line — no line-break markup, no added elements', () => {
    const captionMatch = html.match(/<p id="pong-control-hints">([^<]*)<\/p>/);
    expect(captionMatch).not.toBeNull();
    expect(captionMatch[1]).not.toMatch(/<br/);

    // Only one #pong-control-hints element/rule exists — no duplicate node added.
    const idOccurrences = (html.match(/id="pong-control-hints"/g) || []).length;
    expect(idOccurrences).toBe(1);
  });
});

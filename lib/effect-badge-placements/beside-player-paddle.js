'use strict';

/**
 * lib/effect-badge-placements/beside-player-paddle.js — the
 * "beside-player-paddle" option of the where-the-effect-badge-sits Trait.
 *
 * Each active Power-Ups effect is drawn on the canvas as a chip just to the
 * right of the player's paddle, stacked down from the paddle's top edge, so
 * the chips follow the paddle as it moves. Every chip carries a countdown bar
 * that shrinks as the effect runs out. The page loads this file as a plain
 * script (PongBesidePaddleBadge) and calls drawChips from its draw loop; the
 * server side calls clientConfig() for the setting the page reads.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PongBesidePaddleBadge = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const PLACEMENT = 'beside-player-paddle';

  const CHIP_W   = 96;  // canvas units
  const CHIP_H   = 20;
  const CHIP_GAP = 4;
  const BAR_H    = 4;
  const OFFSET_X = 10;  // gap between the paddle's right edge and the chips

  function clientConfig() {
    return { placement: PLACEMENT };
  }

  /**
   * Where each chip goes, and how full its countdown bar is.
   *
   *   effects     [{ kind, remaining }]
   *   paddle      { x, y, w, h }
   *   kinds       { [kind]: { name, colour } }
   *   durationsS  { [kind]: seconds an effect lasts when freshly picked up }
   *   canvasH     field height, so the stack stays on screen
   *
   * Returns [{ kind, label, colour, x, y, w, h, fraction }], fraction in 0..1.
   */
  function layoutChips(effects, paddle, kinds, durationsS, canvasH) {
    const list = effects || [];
    const stackH = list.length * CHIP_H + Math.max(0, list.length - 1) * CHIP_GAP;
    let top = paddle.y;
    if (typeof canvasH === 'number') top = Math.min(top, canvasH - stackH);
    top = Math.max(0, top);
    return list.map((effect, i) => {
      const kind = kinds[effect.kind] || { name: effect.kind, colour: '#fff' };
      const total = durationsS && durationsS[effect.kind];
      const fraction = total > 0 ? Math.min(1, Math.max(0, effect.remaining / total)) : 0;
      return {
        kind: effect.kind,
        label: kind.name + ' ' + Math.max(0, Math.ceil(effect.remaining)) + 's',
        colour: kind.colour,
        x: paddle.x + paddle.w + OFFSET_X,
        y: top + i * (CHIP_H + CHIP_GAP),
        w: CHIP_W,
        h: CHIP_H,
        fraction,
      };
    });
  }

  /** Draw the chips on a 2d canvas context. Leaves the context's state as it found it. */
  function drawChips(ctx, effects, paddle, kinds, durationsS, canvasH) {
    const chips = layoutChips(effects, paddle, kinds, durationsS, canvasH);
    if (chips.length === 0) return chips;
    ctx.save();
    ctx.setLineDash([]);
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    chips.forEach((chip) => {
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = chip.colour;
      ctx.fillRect(chip.x, chip.y, chip.w, chip.h);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(chip.label, chip.x + 6, chip.y + (chip.h - BAR_H) / 2);
      // Countdown bar along the chip's bottom edge, shrinking towards the left.
      ctx.fillStyle = 'rgba(26, 26, 26, 0.25)';
      ctx.fillRect(chip.x, chip.y + chip.h - BAR_H, chip.w, BAR_H);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(chip.x, chip.y + chip.h - BAR_H, chip.w * chip.fraction, BAR_H);
    });
    ctx.restore();
    return chips;
  }

  return { PLACEMENT, CHIP_W, CHIP_H, CHIP_GAP, BAR_H, OFFSET_X, clientConfig, layoutChips, drawChips };
}));

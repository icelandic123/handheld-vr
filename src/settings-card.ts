import { Vector3 } from '@iwsdk/core';
import { FONT, INK, INK_SOFT, TextBand } from './hud.js';
import { describe, Settings } from './settings.js';

const W = 0.2;
const H = 0.21;
const HEADER = 0.045;
const ROWS = 4;

/**
 * A little card standing on the table with four pokeable rows (subtitles,
 * text size, screen distance, puppet hand). Each poke moves a row to its next
 * value. Hands only, no controllers.
 */
export class SettingsCard {
  private readonly band = new TextBand(W, H, 512);
  readonly mesh = this.band.mesh;
  private highlight = -1;
  private highlightUntil = 0;

  draw(s: Settings, now: number): void {
    const hl = now < this.highlightUntil ? this.highlight : -1;
    const rows = describe(s);
    this.band.draw(`${JSON.stringify(s)}|${hl}`, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(246, 228, 196, 0.96)';
      ctx.beginPath();
      ctx.roundRect(4, 4, w - 8, h - 8, 24);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.round(h * 0.085)}px ${FONT}`;
      ctx.fillText('Settings', w / 2, h * (HEADER / H) * 0.85 + 6);
      const rowH = (h * (1 - HEADER / H) - 12) / ROWS;
      rows.forEach((r, i) => {
        const y = h * (HEADER / H) + 6 + i * rowH;
        ctx.fillStyle = i === hl ? 'rgba(240, 180, 106, 0.85)' : 'rgba(120, 72, 36, 0.12)';
        ctx.beginPath();
        ctx.roundRect(18, y + 6, w - 36, rowH - 12, 16);
        ctx.fill();
        ctx.textAlign = 'left';
        ctx.fillStyle = INK_SOFT;
        ctx.font = `${Math.round(rowH * 0.34)}px ${FONT}`;
        ctx.fillText(r.label, 36, y + rowH * 0.62);
        ctx.textAlign = 'right';
        ctx.fillStyle = INK;
        ctx.font = `bold ${Math.round(rowH * 0.36)}px ${FONT}`;
        ctx.fillText(r.value, w - 36, y + rowH * 0.62);
      });
    });
  }

  /** Which row a fingertip (in this card's local space) is poking, or -1. */
  hitRow(local: Vector3): number {
    if (Math.abs(local.z) > 0.015) return -1;
    if (Math.abs(local.x) > W / 2 - 0.01) return -1;
    const fromTop = H / 2 - local.y - HEADER;
    if (fromTop < 0) return -1;
    const row = Math.floor(fromTop / ((H - HEADER) / ROWS));
    return row >= 0 && row < ROWS ? row : -1;
  }

  flash(row: number, now: number): void {
    this.highlight = row;
    this.highlightUntil = now + 0.5;
  }

  keyOf(row: number, s: Settings): keyof Settings {
    return describe(s)[row].key;
  }
}

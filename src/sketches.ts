/**
 * Little ink drawings of each character, shown on a card pinned to the paper
 * screen so the player knows what the hand shape is meant to become. All paths
 * are hand-written here (no image assets). Coordinates are in a unit box
 * (0..1 across, 0..1 down) scaled into the card.
 */
type Painter = (ctx: CanvasRenderingContext2D) => void;

const EYE = 'rgba(255, 236, 200, 1)';

function eye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.fillStyle = EYE;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const dog: Painter = (ctx) => {
  ctx.beginPath();
  ctx.moveTo(0.12, 0.96);
  ctx.lineTo(0.13, 0.58);
  ctx.quadraticCurveTo(0.14, 0.36, 0.27, 0.3);
  ctx.lineTo(0.3, 0.06); // ear
  ctx.quadraticCurveTo(0.38, 0.14, 0.43, 0.28);
  ctx.quadraticCurveTo(0.55, 0.25, 0.62, 0.33);
  ctx.lineTo(0.9, 0.37); // snout
  ctx.quadraticCurveTo(0.98, 0.39, 0.95, 0.47); // nose
  ctx.lineTo(0.63, 0.51); // upper lip back to the corner of the mouth
  ctx.lineTo(0.88, 0.62); // lower jaw, mouth open
  ctx.quadraticCurveTo(0.89, 0.69, 0.8, 0.69);
  ctx.lineTo(0.56, 0.69);
  ctx.quadraticCurveTo(0.44, 0.72, 0.42, 0.96);
  ctx.closePath();
  ctx.fill();
  eye(ctx, 0.52, 0.37, 0.028);
};

const rabbit: Painter = (ctx) => {
  ctx.beginPath();
  ctx.ellipse(0.45, 0.74, 0.27, 0.2, 0, 0, Math.PI * 2); // body
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.69, 0.5, 0.14, 0, Math.PI * 2); // head
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0.6, 0.2, 0.045, 0.19, -0.35, 0, Math.PI * 2); // ears
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0.73, 0.19, 0.045, 0.19, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.17, 0.74, 0.06, 0, Math.PI * 2); // tail
  ctx.fill();
  eye(ctx, 0.74, 0.46, 0.024);
};

const bird: Painter = (ctx) => {
  ctx.beginPath();
  ctx.ellipse(0.5, 0.62, 0.26, 0.09, -0.12, 0, Math.PI * 2); // body
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.78, 0.52, 0.085, 0, Math.PI * 2); // head
  ctx.fill();
  ctx.beginPath(); // beak
  ctx.moveTo(0.84, 0.48);
  ctx.lineTo(0.98, 0.53);
  ctx.lineTo(0.84, 0.57);
  ctx.fill();
  ctx.beginPath(); // near wing, raised
  ctx.moveTo(0.38, 0.6);
  ctx.quadraticCurveTo(0.22, 0.32, 0.18, 0.06);
  ctx.quadraticCurveTo(0.42, 0.22, 0.62, 0.56);
  ctx.fill();
  ctx.beginPath(); // tail
  ctx.moveTo(0.3, 0.62);
  ctx.lineTo(0.06, 0.52);
  ctx.lineTo(0.1, 0.74);
  ctx.fill();
  eye(ctx, 0.8, 0.5, 0.02);
};

const lamp: Painter = (ctx) => {
  ctx.beginPath();
  ctx.arc(0.5, 0.42, 0.13, 0, Math.PI * 2); // glass
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.42, 0.55);
  ctx.lineTo(0.58, 0.55);
  ctx.lineTo(0.62, 0.88);
  ctx.lineTo(0.38, 0.88);
  ctx.fill();
  ctx.fillRect(0.28, 0.88, 0.44, 0.06); // base
  ctx.lineWidth = 0.03;
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI + (i / 6) * Math.PI; // rays over the top half
    ctx.beginPath();
    ctx.moveTo(0.5 + Math.cos(a) * 0.19, 0.42 + Math.sin(a) * 0.19);
    ctx.lineTo(0.5 + Math.cos(a) * 0.3, 0.42 + Math.sin(a) * 0.3);
    ctx.stroke();
  }
  eye(ctx, 0.5, 0.42, 0.06); // the flame
};

const swan: Painter = (ctx) => {
  ctx.beginPath(); // body
  ctx.ellipse(0.45, 0.78, 0.3, 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath(); // neck curving up to the head
  ctx.moveTo(0.62, 0.74);
  ctx.quadraticCurveTo(0.8, 0.5, 0.66, 0.3);
  ctx.quadraticCurveTo(0.6, 0.18, 0.7, 0.13);
  ctx.lineTo(0.78, 0.15);
  ctx.lineTo(0.94, 0.24); // beak
  ctx.lineTo(0.79, 0.24);
  ctx.quadraticCurveTo(0.72, 0.28, 0.76, 0.36);
  ctx.quadraticCurveTo(0.9, 0.56, 0.72, 0.8);
  ctx.fill();
  ctx.beginPath(); // tail
  ctx.moveTo(0.18, 0.74);
  ctx.lineTo(0.06, 0.62);
  ctx.lineTo(0.2, 0.84);
  ctx.fill();
  eye(ctx, 0.73, 0.19, 0.018);
};

const snail: Painter = (ctx) => {
  ctx.beginPath(); // foot
  ctx.moveTo(0.06, 0.86);
  ctx.quadraticCurveTo(0.5, 0.8, 0.8, 0.72);
  ctx.quadraticCurveTo(0.86, 0.6, 0.82, 0.52); // head
  ctx.lineTo(0.88, 0.3); // feeler
  ctx.lineTo(0.9, 0.31);
  ctx.lineTo(0.86, 0.54);
  ctx.quadraticCurveTo(0.95, 0.7, 0.86, 0.86);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); // shell
  ctx.arc(0.45, 0.58, 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = EYE;
  ctx.lineWidth = 0.025;
  ctx.beginPath(); // spiral
  for (let i = 0; i <= 60; i++) {
    const a = i * 0.26;
    const r = 0.02 + i * 0.0033;
    const x = 0.45 + Math.cos(a) * r;
    const y = 0.58 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  eye(ctx, 0.84, 0.6, 0.018);
};

const PAINTERS: Record<string, Painter> = { dog, rabbit, bird, swan, snail, hello: lamp };

/** Draw the character card for a puppet id into a canvas region. */
export function drawSketchCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  id: string,
  caption: string,
  ink: string,
  font: string,
  mirror = false,
): void {
  // Card: a slightly darker paper patch with a thin ink border.
  ctx.fillStyle = 'rgba(120, 72, 36, 0.12)';
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(2, w * 0.012);
  const pad = w * 0.03;
  ctx.beginPath();
  ctx.roundRect(pad, pad, w - pad * 2, h - pad * 2, w * 0.05);
  ctx.fill();
  ctx.stroke();
  const painter = PAINTERS[id];
  if (painter) {
    const size = Math.min(w * 0.78, h * 0.68);
    ctx.save();
    ctx.translate((w - size) / 2, h * 0.08);
    ctx.scale(size, size);
    if (mirror) {
      // Match the shadow: a right-handed dog faces left.
      ctx.translate(1, 0);
      ctx.scale(-1, 1);
    }
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    painter(ctx);
    ctx.restore();
  }
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.font = `italic ${Math.round(h * 0.13)}px ${font}`;
  ctx.fillText(caption, w / 2, h * 0.89);
}

const GREEN = "#00d35a";
const ORANGE = "#ff9f0a";

function ctx2d(canvas) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height, dpr };
}

export function drawEquity(canvas, { points = [], marks = [], startLine = null, reduced = false } = {}) {
  const { ctx, w, h } = ctx2d(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!points.length) return { markPos: [] };
  const padL = 8, padR = 8, padT = 44, padB = 16;
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys, startLine == null ? ys[0] : startLine);
  const maxY = Math.max(...ys, startLine == null ? ys[0] : startLine);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1e-9, maxY - minY);
  const X = (t) => padL + ((t - minX) / spanX) * (w - padL - padR);
  const Y = (v) => padT + (1 - (v - minY) / spanY) * (h - padT - padB);

  const path = new Path2D();
  points.forEach((p, i) => {
    const x = X(p.t), y = Y(p.v);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });

  const fill = new Path2D(path);
  const last = points[points.length - 1];
  fill.lineTo(X(last.t), h - padB);
  fill.lineTo(X(points[0].t), h - padB);
  fill.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
  grad.addColorStop(0, "rgba(0,211,90,0.28)");
  grad.addColorStop(1, "rgba(0,211,90,0)");
  ctx.fillStyle = grad;
  ctx.fill(fill);

  if (startLine != null) {
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(235,235,245,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, Y(startLine));
    ctx.lineTo(w - padR, Y(startLine));
    ctx.stroke();
    ctx.restore();
  }

  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(path);

  // Stack marks so a later one moves up a row and never overlaps.
  const markPos = [];
  const rowH = 14;
  const used = [];
  const sorted = marks.slice().sort((a, b) => a.t - b.t);
  for (const m of sorted) {
    const x = X(m.t);
    const yLine = Y(nearest(points, m.t).v);
    let row = 0;
    let y = yLine - 16;
    const collide = () => used.some((u) => Math.abs(u.x - x) < 56 && u.row === row);
    while (collide()) row += 1;
    y = yLine - 16 - row * rowH;
    used.push({ x, row });
    markPos.push({ ...m, x, y, row });
  }
  void reduced;
  return { markPos };
}

function nearest(points, t) {
  let best = points[0], d = Math.abs(points[0].t - t);
  for (const p of points) {
    const n = Math.abs(p.t - t);
    if (n < d) { best = p; d = n; }
  }
  return best;
}

export function drawCandles(canvas, { candles = [], exitLine = null } = {}) {
  const { ctx, w, h } = ctx2d(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!candles.length) return;
  const pad = { l: 8, r: 8, t: 8, b: 8 };
  const lows = candles.map((c) => c.l);
  const highs = candles.map((c) => c.h);
  if (exitLine != null) { lows.push(exitLine); highs.push(exitLine); }
  const minY = Math.min(...lows);
  const maxY = Math.max(...highs);
  const spanY = Math.max(1e-12, maxY - minY);
  const Y = (v) => pad.t + (1 - (v - minY) / spanY) * (h - pad.t - pad.b);
  const slot = (w - pad.l - pad.r) / candles.length;
  const bodyW = Math.max(1, Math.min(8, slot * 0.6));

  if (exitLine != null) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(exitLine));
    ctx.lineTo(w - pad.r, Y(exitLine));
    ctx.stroke();
    ctx.restore();
  }

  candles.forEach((c, i) => {
    const x = pad.l + (i + 0.5) * slot;
    const up = c.c >= c.o;
    ctx.strokeStyle = up ? GREEN : "#ff453a";
    ctx.fillStyle = up ? GREEN : "#ff453a";
    ctx.beginPath();
    ctx.moveTo(x, Y(c.h));
    ctx.lineTo(x, Y(c.l));
    ctx.stroke();
    const y1 = Y(c.o), y2 = Y(c.c);
    const top = Math.min(y1, y2), bh = Math.max(1, Math.abs(y2 - y1));
    ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
  });
}

export function drawScoreRing(canvas, score) {
  const { ctx, w, h } = ctx2d(canvas);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 3;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#2c2c2e";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  const v = Math.max(0, Math.min(100, Number(score) || 0));
  const color = v >= 70 ? GREEN : "#ff9f0a";
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (v / 100) * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "600 12px -apple-system, Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(v)), cx, cy);
}

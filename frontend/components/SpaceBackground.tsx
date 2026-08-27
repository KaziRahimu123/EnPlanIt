"use client";

/**
 * SpaceBackground — AstroOps Combined Ultimate
 *
 * Rendering pipeline (back → front, every rAF frame):
 *   1. putImageData — static cache:
 *        base fill → distant nebulae/glows → celestial grid → orbital arcs
 *        → HUD rings + degree markers + crosshairs + targeting brackets
 *        → Earth body + city lights → atmospheric rim glow + upward haze
 *        → telemetry leader lines → telemetry text
 *   2. Animated waypoints (slow along orbital ellipses)
 *   3. Orbital pulse dots (medium speed sweep)
 *   4. Spacecraft marker (very slow, single orbit)
 *   5. Star layers (3-depth drift + parallax + twinkle)
 *
 * Performance contract
 *   • Static cache is one ImageData rebuilt only on resize.
 *   • Per-frame draws: waypoints (4) + pulses (4) + spacecraft (1) + stars (≤400).
 *   • All Canvas 2D — no WebGL, no offscreen workers.
 *   • prefers-reduced-motion: one static snapshot then stops rAF.
 */

import { useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinklePhase: number;
  twinkleSpeed: number;
}

interface Layer {
  stars: Star[];
  driftSpeed: number;
  parallaxFactor: number;
}

interface Waypoint {
  orbitIdx: number;
  angle: number;
  speed: number;       // rad/s
  size: number;
  alpha: number;
  color: string;
}

interface OrbPulse {
  orbitIdx: number;
  angle: number;
  speed: number;
  alpha: number;
}

interface Spacecraft {
  orbitIdx: number;
  angle: number;
  speed: number;       // very slow
}

// ─── Static world constants ───────────────────────────────────────────────────

const LAYER_CONFIGS: Pick<Layer, "driftSpeed" | "parallaxFactor">[] = [
  { driftSpeed: 0.00008, parallaxFactor: 0.002 }, // distant
  { driftSpeed: 0.00020, parallaxFactor: 0.005 }, // mid
  { driftSpeed: 0.00040, parallaxFactor: 0.010 }, // near
];

const STAR_COUNTS    = [320, 140, 62];
const SIZE_RANGES    = [[0.25, 0.75], [0.50, 1.20], [0.80, 1.90]];
const OPACITY_RANGES = [[0.09, 0.35], [0.22, 0.52], [0.38, 0.80]];

// Orbital ellipses — [cx_frac, cy_frac, rx_frac, ry_frac, tiltDeg, alpha, isOrange]
const ORBITS: [number, number, number, number, number, number, boolean][] = [
  [0.50, 0.52, 0.42, 0.150,  12, 0.075, false], // main inner
  [0.50, 0.52, 0.60, 0.210,  -6, 0.050, false], // main outer
  [0.50, 0.52, 0.28, 0.092,   5, 0.062, false], // tight
  [0.50, 0.52, 0.74, 0.260,  22, 0.038, false], // wide outer
  [0.50, 0.52, 0.50, 0.130, -18, 0.042, true],  // orange accent
];

// HUD degree arc markers along an outer reference circle
// [angleDeg, label]
const HUD_DEGREES: [number, string][] = [
  [-120, "-120°"],
  [ -90, "-90°" ],
  [ -60, "-60°" ],
  [   0,   "0°" ],
  [  30,  "30°" ],
  [  60,  "60°" ],
  [  90,  "90°" ],
];

// Targeting circles — [cx, cy, r_frac, alpha, brackets]
const HUD_RINGS: [number, number, number, number, boolean][] = [
  [0.50, 0.52, 0.055, 0.095, true ],  // centre
  [0.50, 0.52, 0.085, 0.060, true ],  // centre outer
  [0.78, 0.62, 0.030, 0.080, true ],  // secondary target
  [0.20, 0.28, 0.036, 0.072, true ],  // upper-left
  [0.12, 0.60, 0.022, 0.060, false],  // left accent
  [0.88, 0.38, 0.026, 0.055, false],  // right accent
];

// Crosshair markers — [cx, cy, halfLen, alpha]
const CROSSHAIRS: [number, number, number, number][] = [
  [0.50, 0.52, 10, 0.080],
  [0.78, 0.62,  6, 0.070],
  [0.20, 0.28,  5, 0.065],
  [0.08, 0.18,  4, 0.055],
  [0.92, 0.75,  4, 0.050],
];

// Telemetry text labels — [x_frac, y_frac, label, value, alpha]
// y_frac is now relative to full doc height — spread evenly
const TELEMETRY: [number, number, string, string, number][] = [
  // Hero zone (y ≈ 0..0.30)
  [0.04, 0.08, "VECTOR",   "24.7°",      0.100],
  [0.04, 0.11, "ALT",      "218 KM",     0.082],
  [0.04, 0.14, "T+",       "04:12:18",   0.088],
  [0.68, 0.09, "ORBIT",    "LEO",        0.092],
  [0.68, 0.12, "VELOCITY", "7.67 KM/S",  0.078],
  [0.68, 0.15, "INC",      "51.6°",      0.072],
  // Mission Intelligence zone (y ≈ 0.30..0.60)
  [0.04, 0.36, "ΔV",       "+12.4 M/S",  0.072],
  [0.04, 0.40, "APOGEE",   "428 KM",     0.065],
  [0.68, 0.38, "COMMS",    "NOMINAL",    0.068],
  [0.68, 0.42, "LINK",     "98%",        0.065],
  // Mission Readiness zone (y ≈ 0.60..0.90)
  [0.04, 0.66, "RANGE",    "1240 KM",    0.068],
  [0.04, 0.70, "PWR",      "87%",        0.060],
  [0.68, 0.67, "TRAJECTORY","NOMINAL",   0.072],
  [0.68, 0.71, "PHASE",    "+002.4°",    0.060],
];

// Telemetry leader lines — [y_frac, x0_frac, x1_frac, alpha]
const TEL_LINES: [number, number, number, number][] = [
  [0.08, 0.03, 0.038, 0.082],
  [0.09, 0.66, 0.672, 0.078],
  [0.36, 0.03, 0.038, 0.072],
  [0.38, 0.66, 0.672, 0.068],
  [0.66, 0.03, 0.038, 0.068],
  [0.67, 0.66, 0.672, 0.065],
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function buildLayer(idx: number): Layer {
  const [sMin, sMax] = SIZE_RANGES[idx];
  const [oMin, oMax] = OPACITY_RANGES[idx];
  const stars: Star[] = Array.from({ length: STAR_COUNTS[idx] }, () => ({
    x: Math.random(),
    y: Math.random(),
    size: rand(sMin, sMax),
    opacity: rand(oMin, oMax),
    twinklePhase: rand(0, Math.PI * 2),
    twinkleSpeed: rand(0.25, 0.90),
  }));
  return { stars, ...LAYER_CONFIGS[idx] };
}

function orbitPoint(
  w: number, h: number,
  orbitIdx: number,
  angle: number,
): [number, number] {
  const [ocx, ocy, orx, ory, tilt] = ORBITS[orbitIdx];
  const tiltRad = (tilt * Math.PI) / 180;
  const lx = orx * w * Math.cos(angle);
  const ly = ory * h * Math.sin(angle);
  const x = ocx * w + lx * Math.cos(tiltRad) - ly * Math.sin(tiltRad);
  const y = ocy * h + lx * Math.sin(tiltRad) + ly * Math.cos(tiltRad);
  return [x, y];
}

// ─── Static cache builder ─────────────────────────────────────────────────────

function buildStaticCache(w: number, h: number): ImageData {
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const ctx = tmp.getContext("2d")!;

  // ── 1. Deep navy base ───────────────────────────────────────────────────────
  ctx.fillStyle = "#06091a";
  ctx.fillRect(0, 0, w, h);

  // ── 2. Distant nebulae / atmospheric color blobs — distributed across full height ─
  const blobs: [number, number, number, number, number, number, number][] = [
    // hero zone (top)
    [0.12, 0.08, 0.28,  22,  44, 120, 0.028],
    [0.86, 0.06, 0.22,  55,  22, 130, 0.022],
    [0.50, 0.18, 0.38,   0,  60, 140, 0.018],
    // mission intelligence zone (1/3 down)
    [0.20, 0.32, 0.26,   0,  75, 140, 0.020],
    [0.78, 0.38, 0.24,  40,  30, 110, 0.018],
    [0.50, 0.42, 0.30,  15,  35, 130, 0.016],
    // mission readiness zone (2/3 down)
    [0.15, 0.62, 0.26,  60,   0, 110, 0.020],
    [0.85, 0.68, 0.22,  45,   0, 100, 0.018],
    [0.50, 0.72, 0.32,  30,  18,  95, 0.016],
    // bottom zone
    [0.30, 0.88, 0.22,   0,  65, 130, 0.016],
    [0.70, 0.90, 0.20,  35,  40, 120, 0.015],
  ];
  blobs.forEach(([cx, cy, r, R, G, B, a]) => {
    const x = cx * w, y = cy * h;
    const radius = r * Math.max(w, h);
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0,    `rgba(${R},${G},${B},${a})`);
    g.addColorStop(0.5,  `rgba(${R},${G},${B},${+(a * 0.4).toFixed(4)})`);
    g.addColorStop(1,    "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  });

  // ── 3. Hero soft blue glow (behind centre UI) ───────────────────────────────
  {
    const gx = w * 0.50, gy = h * 0.42, gr = Math.max(w, h) * 0.32;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0,   "rgba(0,80,170,0.030)");
    g.addColorStop(0.5, "rgba(0,60,130,0.018)");
    g.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  // ── 4. Celestial reference grid ─────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = "rgba(50,110,220,0.018)";
  ctx.lineWidth = 0.5;
  const gridSize = 44;
  ctx.beginPath();
  for (let gx = 0; gx <= w; gx += gridSize) {
    ctx.moveTo(gx, 0); ctx.lineTo(gx, h);
  }
  for (let gy = 0; gy <= h; gy += gridSize) {
    ctx.moveTo(0, gy); ctx.lineTo(w, gy);
  }
  ctx.stroke();
  // Coordinate tick marks at every 4th intersection
  ctx.strokeStyle = "rgba(70,140,240,0.040)";
  ctx.lineWidth = 0.7;
  for (let gx = gridSize; gx < w; gx += gridSize * 4) {
    for (let gy = gridSize; gy < h; gy += gridSize * 4) {
      const t = 4;
      ctx.beginPath();
      ctx.moveTo(gx - t, gy); ctx.lineTo(gx + t, gy);
      ctx.moveTo(gx, gy - t); ctx.lineTo(gx, gy + t);
      ctx.stroke();
    }
  }
  ctx.restore();

  // ── 5. Orbital trajectory arcs ──────────────────────────────────────────────
  ORBITS.forEach(([ocx, ocy, orx, ory, tilt, alpha, isOrange]) => {
    const cx = ocx * w, cy = ocy * h;
    const rx = orx * w, ry = ory * h;
    const tiltRad = (tilt * Math.PI) / 180;

    const baseColor = isOrange ? "220,100,40" : "59,130,246";
    const tickColor = isOrange ? "240,130,60" : "96,165,250";

    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(tiltRad);

    // Main arc — dashed
    ctx.strokeStyle = `rgba(${baseColor},${alpha})`;
    ctx.lineWidth = isOrange ? 0.55 : 0.60;
    ctx.setLineDash(isOrange ? [4, 16] : [6, 12]);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Cardinal tick marks on orbit
    ctx.strokeStyle = `rgba(${tickColor},${+(alpha * 1.2).toFixed(4)})`;
    ctx.lineWidth = 0.8;
    [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5].forEach((a) => {
      const px = rx * Math.cos(a), py = ry * Math.sin(a);
      const nx = Math.cos(a), ny = Math.sin(a);
      const tk = isOrange ? 3 : 5;
      ctx.beginPath();
      ctx.moveTo(px - ny * tk, py + nx * tk);
      ctx.lineTo(px + ny * tk, py - nx * tk);
      ctx.stroke();
    });
    ctx.restore();
  });

  // ── 6. Outer HUD reference arc with degree markers ──────────────────────────
  {
    const cx = w * 0.50, cy = h * 0.52;
    const arcR = Math.min(w, h) * 0.44; // large reference arc radius

    ctx.save();
    // Outer arc — very faint partial ring
    ctx.strokeStyle = "rgba(96,165,250,0.040)";
    ctx.lineWidth = 0.6;
    ctx.setLineDash([2, 8]);
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, -Math.PI * 0.85, Math.PI * 0.05);
    ctx.stroke();
    ctx.setLineDash([]);

    // Degree markers
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    HUD_DEGREES.forEach(([deg, label]) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      const mx = cx + arcR * Math.cos(rad);
      const my = cy + arcR * Math.sin(rad);
      const nx = Math.cos(rad), ny = Math.sin(rad);
      const tickLen = 7;

      // Tick
      ctx.strokeStyle = "rgba(96,165,250,0.070)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - nx * tickLen, my - ny * tickLen);
      ctx.stroke();

      // Label
      const lx = mx - nx * (tickLen + 14);
      const ly = my - ny * (tickLen + 14);
      ctx.fillStyle = "rgba(96,165,250,0.065)";
      ctx.fillText(label, lx, ly);
    });
    ctx.restore();
  }

  // ── 7. HUD targeting rings ───────────────────────────────────────────────────
  HUD_RINGS.forEach(([cx, cy, r, alpha, brackets]) => {
    const x = cx * w, y = cy * h;
    const radius = r * Math.min(w, h);

    // Full thin ring
    ctx.strokeStyle = `rgba(96,165,250,${alpha})`;
    ctx.lineWidth = 0.65;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();

    if (brackets) {
      // Corner bracket arcs (4 × 50° at cardinal positions)
      ctx.strokeStyle = `rgba(96,165,250,${+(alpha * 1.5).toFixed(4)})`;
      ctx.lineWidth = 1.0;
      const bLen = Math.PI / 3.6;
      [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5].forEach((a) => {
        ctx.beginPath();
        ctx.arc(x, y, radius, a - bLen / 2, a + bLen / 2);
        ctx.stroke();
      });
    }
  });

  // ── 8. Crosshair markers ─────────────────────────────────────────────────────
  CROSSHAIRS.forEach(([cx, cy, half, alpha]) => {
    const x = cx * w, y = cy * h;
    ctx.strokeStyle = `rgba(96,165,250,${alpha})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x - half, y); ctx.lineTo(x - half * 0.35, y);
    ctx.moveTo(x + half * 0.35, y); ctx.lineTo(x + half, y);
    ctx.moveTo(x, y - half); ctx.lineTo(x, y - half * 0.35);
    ctx.moveTo(x, y + half * 0.35); ctx.lineTo(x, y + half);
    ctx.stroke();
    // Centre dot
    ctx.fillStyle = `rgba(148,197,253,${+(alpha * 0.90).toFixed(4)})`;
    ctx.beginPath(); ctx.arc(x, y, 1.0, 0, Math.PI * 2); ctx.fill();
  });

  // ── 9. (Earth is now rendered as a real image in page.tsx — no canvas Earth)
  // Retain a subtle canvas-side atmospheric colour hint at the bottom so the
  // canvas background blends into the real Earth image above it.
  {
    const haze = ctx.createLinearGradient(0, h, 0, h * 0.60);
    haze.addColorStop(0,    "rgba(0,50,140,0.045)");
    haze.addColorStop(0.40, "rgba(0,35,110,0.020)");
    haze.addColorStop(1,    "rgba(0,0,0,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.60, w, h * 0.40);
  }

  // ── 10. Telemetry leader lines ───────────────────────────────────────────────
  TEL_LINES.forEach(([yf, x0f, x1f, alpha]) => {
    const y = yf * h, x0 = x0f * w, x1 = x1f * w;
    ctx.strokeStyle = `rgba(96,165,250,${alpha})`;
    ctx.lineWidth = 0.6;
    ctx.setLineDash([2, 7]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = `rgba(96,165,250,${+(alpha * 1.1).toFixed(4)})`;
    ctx.lineWidth = 0.8;
    const tk = 2.5;
    ctx.beginPath();
    ctx.moveTo(x1, y - tk); ctx.lineTo(x1, y + tk); ctx.stroke();
  });

  // ── 11. Telemetry text ───────────────────────────────────────────────────────
  ctx.save();
  ctx.font = "8px monospace";
  ctx.textBaseline = "middle";
  TELEMETRY.forEach(([xf, yf, label, value, alpha]) => {
    const x = xf * w, y = yf * h;
    ctx.fillStyle = `rgba(96,165,250,${+(alpha * 0.85).toFixed(4)})`;
    ctx.textAlign = "left";
    ctx.fillText(label, x, y);
    ctx.fillStyle = `rgba(186,230,253,${alpha})`;
    ctx.fillText(value, x + 56, y);
  });
  ctx.restore();

  return ctx.getImageData(0, 0, w, h);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SpaceBackground() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const mouseRef    = useRef({ x: 0, y: 0 });
  const layersRef   = useRef<Layer[]>([]);
  const rafRef      = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const waypointsRef  = useRef<Waypoint[]>([]);
  const orbPulsesRef  = useRef<OrbPulse[]>([]);
  const spacecraftRef = useRef<Spacecraft>({ orbitIdx: 0, angle: 0, speed: 0.004 });

  const reducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // Build layers + animated actors once
  useEffect(() => {
    layersRef.current = LAYER_CONFIGS.map((_, i) => buildLayer(i));

    waypointsRef.current = ORBITS.map((_, i) => ({
      orbitIdx: i,
      angle: rand(0, Math.PI * 2),
      speed: rand(0.0015, 0.0035),
      size: i < 2 ? 3.8 : 2.8,
      alpha: i < 2 ? 0.130 : 0.095,
      color: ORBITS[i][6] ? "#fb923c" : "#60a5fa",
    }));

    orbPulsesRef.current = ORBITS.map((_, i) => ({
      orbitIdx: i,
      angle: rand(0, Math.PI * 2),
      speed: rand(0.02, 0.04),
      alpha: i < 2 ? 0.110 : 0.080,
    }));

    // Spacecraft on orbit 1 (main outer)
    spacecraftRef.current = { orbitIdx: 1, angle: rand(0, Math.PI * 2), speed: 0.0012 };
  }, []);

  // Mouse for parallax
  useEffect(() => {
    if (reducedMotion) return;
    const onMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: (e.clientX / window.innerWidth)  * 2 - 1,
        y: (e.clientY / window.innerHeight) * 2 - 1,
      };
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [reducedMotion]);

  // Draw star layer
  const drawStarLayer = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      layer: Layer,
      w: number, h: number,
      time: number,
      mouse: { x: number; y: number },
    ) => {
      const pxOff = mouse.x * layer.parallaxFactor * w;
      const pyOff = mouse.y * layer.parallaxFactor * h;

      layer.stars.forEach((star) => {
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinklePhase);
        const alpha = Math.max(0, Math.min(1, star.opacity + twinkle * 0.08 * star.opacity));
        const sx = ((star.x * w + pxOff) % w + w) % w;
        const sy = star.y * h + pyOff;

        ctx.globalAlpha = alpha;
        ctx.fillStyle   = "#ffffff";
        ctx.beginPath(); ctx.arc(sx, sy, star.size, 0, Math.PI * 2); ctx.fill();

        if (star.size > 1.0) {
          const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, star.size * 2.8);
          gr.addColorStop(0, `rgba(200,220,255,${alpha * 0.28})`);
          gr.addColorStop(1, "rgba(200,220,255,0)");
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(sx, sy, star.size * 2.8, 0, Math.PI * 2); ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
    },
    [],
  );

  // Draw animated elements
  const drawAnimated = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => {

      // ── Orbital pulse dots ────────────────────────────────────────────────
      orbPulsesRef.current.forEach((pulse, i) => {
        const [px, py] = orbitPoint(w, h, pulse.orbitIdx, pulse.angle);
        const isOrange = ORBITS[i][6];
        const dotColor = isOrange ? "251,146,60" : "96,165,250";
        ctx.globalAlpha = pulse.alpha;
        ctx.fillStyle   = isOrange ? "#fb923c" : "#60a5fa";
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
        const gr = ctx.createRadialGradient(px, py, 0, px, py, 6);
        gr.addColorStop(0, `rgba(${dotColor},${pulse.alpha * 0.50})`);
        gr.addColorStop(1, `rgba(${dotColor},0)`);
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
      });

      // ── Waypoint markers ──────────────────────────────────────────────────
      const pingPeriod = 3.2;
      waypointsRef.current.forEach((wp) => {
        const [wx, wy] = orbitPoint(w, h, wp.orbitIdx, wp.angle);
        const ringPhase = (time % pingPeriod) / pingPeriod;

        // Ping ring
        const ringR    = 5 + ringPhase * 12;
        const ringAlpha = wp.alpha * (1 - ringPhase) * 0.50;
        ctx.globalAlpha = ringAlpha;
        ctx.strokeStyle = wp.color;
        ctx.lineWidth   = 0.7;
        ctx.beginPath(); ctx.arc(wx, wy, ringR, 0, Math.PI * 2); ctx.stroke();

        // Crosshair
        const s = wp.size;
        ctx.globalAlpha = wp.alpha;
        ctx.strokeStyle = wp.color;
        ctx.lineWidth   = 0.9;
        ctx.beginPath();
        ctx.moveTo(wx - s, wy); ctx.lineTo(wx - s * 0.3, wy);
        ctx.moveTo(wx + s * 0.3, wy); ctx.lineTo(wx + s, wy);
        ctx.moveTo(wx, wy - s); ctx.lineTo(wx, wy - s * 0.3);
        ctx.moveTo(wx, wy + s * 0.3); ctx.lineTo(wx, wy + s);
        ctx.stroke();

        // Core dot
        ctx.fillStyle = wp.color;
        ctx.beginPath(); ctx.arc(wx, wy, 1.1, 0, Math.PI * 2); ctx.fill();
      });

      // ── Spacecraft marker ─────────────────────────────────────────────────
      {
        const sc = spacecraftRef.current;
        const [sx, sy] = orbitPoint(w, h, sc.orbitIdx, sc.angle);

        // Velocity direction arrow (tangent to orbit)
        const [nx, ny] = orbitPoint(w, h, sc.orbitIdx, sc.angle + 0.05);
        const dx = nx - sx, dy = ny - sy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len, uy = dy / len;

        ctx.globalAlpha = 0.18;
        // Body: tiny filled diamond
        ctx.fillStyle = "#7dd3fc";
        ctx.beginPath();
        ctx.moveTo(sx + ux * 5, sy + uy * 5);
        ctx.lineTo(sx - uy * 2.5, sy + ux * 2.5);
        ctx.lineTo(sx - ux * 3, sy - uy * 3);
        ctx.lineTo(sx + uy * 2.5, sy - ux * 2.5);
        ctx.closePath(); ctx.fill();

        // Velocity vector line
        ctx.strokeStyle = "#7dd3fc";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(sx + ux * 5, sy + uy * 5);
        ctx.lineTo(sx + ux * 14, sy + uy * 14);
        ctx.stroke();

        // Soft glow
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 12);
        glow.addColorStop(0, "rgba(125,211,252,0.10)");
        glow.addColorStop(1, "rgba(125,211,252,0)");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
      }

      ctx.globalAlpha = 1;
    },
    [],
  );

  // Main animation loop — canvas is fixed/viewport-sized, always visible while scrolling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let staticCache: ImageData | null = null;
    let cachedW = 0, cachedH = 0;

    function resize() {
      if (!canvas) return;
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      staticCache   = null;
    }

    function ensureCache(w: number, h: number) {
      if (staticCache && cachedW === w && cachedH === h) return;
      staticCache = buildStaticCache(w, h);
      cachedW = w; cachedH = h;
    }

    resize();
    window.addEventListener("resize", resize, { passive: true });

    function frame(ts: number) {
      if (!canvas || !ctx) return;
      const dt = lastTimeRef.current ? (ts - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = ts;

      const w = canvas.width, h = canvas.height;
      const time = ts / 1000;

      ensureCache(w, h);
      if (staticCache) ctx.putImageData(staticCache, 0, 0);
      else { ctx.fillStyle = "#06091a"; ctx.fillRect(0, 0, w, h); }

      if (reducedMotion) {
        layersRef.current.forEach((layer) =>
          drawStarLayer(ctx, layer, w, h, 0, { x: 0, y: 0 }),
        );
        return;
      }

      // Advance state
      waypointsRef.current.forEach((wp) => {
        wp.angle += wp.speed * dt;
        if (wp.angle > Math.PI * 2) wp.angle -= Math.PI * 2;
      });
      orbPulsesRef.current.forEach((pulse) => {
        pulse.angle += pulse.speed * dt;
        if (pulse.angle > Math.PI * 2) pulse.angle -= Math.PI * 2;
      });
      spacecraftRef.current.angle += spacecraftRef.current.speed * dt;
      if (spacecraftRef.current.angle > Math.PI * 2)
        spacecraftRef.current.angle -= Math.PI * 2;
      layersRef.current.forEach((layer) => {
        layer.stars.forEach((star) => {
          star.x += layer.driftSpeed * dt;
          if (star.x > 1) star.x -= 1;
        });
      });

      drawAnimated(ctx, w, h, time);

      const mouse = mouseRef.current;
      layersRef.current.forEach((layer) =>
        drawStarLayer(ctx, layer, w, h, time, mouse),
      );

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [drawStarLayer, drawAnimated, reducedMotion]);

  return (
    <>
      {/* Canvas — fixed, viewport-sized, always behind scrolling content */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "fixed", inset: 0,
          width: "100%", height: "100%",
          zIndex: 0, pointerEvents: "none", display: "block",
        }}
      />

      {/* CSS atmospheric glows — fixed, always visible while scrolling */}
      <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
        {/* Cyan — top-left */}
        <div aria-hidden="true" style={{
          position: "absolute", top: "-6%", left: "-6%",
          width: "44vw", height: "44vw", borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(0,130,220,0.032) 0%, transparent 66%)",
        }} />

        {/* Purple — bottom-right */}
        <div aria-hidden="true" style={{
          position: "absolute", bottom: "-10%", right: "-6%",
          width: "48vw", height: "48vw", borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(75,25,165,0.030) 0%, transparent 66%)",
        }} />

        {/* Centre blue */}
        <div aria-hidden="true" style={{
          position: "absolute", top: "20%", left: "28%",
          width: "44vw", height: "34vw", borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(0,80,170,0.022) 0%, transparent 70%)",
        }} />

        {/* Vignette */}
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at 50% 48%, transparent 42%, rgba(3,6,18,0.80) 100%)",
        }} />
      </div>
    </>
  );
}

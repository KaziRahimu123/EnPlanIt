"use client";

import { useEffect, useRef } from "react";
import styles from "./GlobalSpaceBackground.module.css";

/**
 * GlobalSpaceBackground — fixed full-viewport canvas starfield for the homepage.
 *
 * Renders:
 *   1. Deep-space base fill (#020611)
 *   2. 3 star depth layers — far (tiny/dim) → near (bright/large) — each with
 *      independent slow drift and per-star twinkle.
 *   3. Micro-dust particles for depth texture.
 *   4. Faint celestial grid overlay (CSS, not canvas — cheaper).
 *   5. Two soft radial atmospheric glows (CSS).
 *
 * Earth, HUD rings, orbital trajectories, and telemetry live in HeroSpaceScene.
 */

interface Star {
  x: number;       // 0–1 relative to canvas width
  y: number;       // 0–1 relative to canvas height
  r: number;       // radius px
  baseAlpha: number;
  twinklePhase: number;
  twinkleSpeed: number;
  driftX: number;  // px/frame at 60 fps
  driftY: number;
  color: string;
}

const LAYER_DEFS = [
  { count: 280, rMin: 0.25, rMax: 0.72, aMin: 0.12, aMax: 0.38, driftScale: 0.012 },
  { count: 120, rMin: 0.50, rMax: 1.10, aMin: 0.28, aMax: 0.58, driftScale: 0.020 },
  { count:  55, rMin: 0.85, rMax: 1.70, aMin: 0.50, aMax: 0.88, driftScale: 0.032 },
];
const STAR_COLORS = [
  "255,255,255",
  "210,230,255",
  "230,240,255",
  "200,215,255",
];
const DUST_COUNT = 180;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function buildStars(): Star[][] {
  return LAYER_DEFS.map((l) =>
    Array.from({ length: l.count }, (): Star => {
      const col = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
      const angle = Math.random() * Math.PI * 2;
      return {
        x: Math.random(),
        y: Math.random(),
        r: rand(l.rMin, l.rMax),
        baseAlpha: rand(l.aMin, l.aMax),
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: rand(0.008, 0.022),
        driftX: Math.cos(angle) * l.driftScale * rand(0.4, 1.0),
        driftY: Math.sin(angle) * l.driftScale * rand(0.4, 1.0),
        color: col,
      };
    })
  );
}

interface Dust {
  x: number;
  y: number;
  r: number;
  a: number;
}

function buildDust(): Dust[] {
  return Array.from({ length: DUST_COUNT }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: rand(0.20, 0.48),
    a: rand(0.04, 0.11),
  }));
}

export default function GlobalSpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const layers = buildStars();
    const dust   = buildDust();
    let t = 0;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function resize() {
      canvas!.width  = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    function draw() {
      const W = canvas!.width;
      const H = canvas!.height;
      t += 1;

      ctx!.fillStyle = "#020611";
      ctx!.fillRect(0, 0, W, H);

      // Micro-dust
      dust.forEach((d) => {
        ctx!.beginPath();
        ctx!.arc(d.x * W, d.y * H, d.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(148,163,184,${d.a})`;
        ctx!.fill();
      });

      // Star layers
      layers.forEach((layer) => {
        layer.forEach((s) => {
          // Slow drift — wrap at boundaries
          s.x += s.driftX / W * 0.8;
          s.y += s.driftY / H * 0.8;
          if (s.x < -0.01) s.x = 1.01;
          if (s.x >  1.01) s.x = -0.01;
          if (s.y < -0.01) s.y = 1.01;
          if (s.y >  1.01) s.y = -0.01;

          const twinkle = 0.68 + 0.32 * Math.sin(t * s.twinkleSpeed + s.twinklePhase);
          const alpha   = s.baseAlpha * twinkle;

          ctx!.beginPath();
          ctx!.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(${s.color},${alpha.toFixed(3)})`;
          ctx!.fill();
        });
      });

      if (!reducedMotion) {
        rafRef.current = requestAnimationFrame(draw);
      }
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className={styles.background} aria-hidden="true">
      <canvas ref={canvasRef} className={styles.canvas} />
      <div className={styles.grid} />
      <div className={styles.glowOne} />
      <div className={styles.glowTwo} />
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import styles from "./SolarSystemHeroBackground.module.css";

interface Planet {
  name: string;
  color: string;
  glowColor: string;
  radius: number;
  orbitRx: number;
  orbitRy: number;
  speed: number;
  angle: number;
  tiltDeg: number;
  label: string;
  hasRings?: boolean;
  ringsRadius?: number;
  hasMoon?: boolean;
}

const PLANETS: Planet[] = [
  {
    name: "Mercury",
    color: "#d1c7b7",
    glowColor: "#f59e0b",
    radius: 4.5,
    orbitRx: 105,
    orbitRy: 52,
    speed: 0.70,
    angle: 0.5,
    tiltDeg: -6,
    label: "MERCURY",
  },
  {
    name: "Venus",
    color: "#f3cc80",
    glowColor: "#fbbf24",
    radius: 7,
    orbitRx: 155,
    orbitRy: 76,
    speed: 0.45,
    angle: 2.2,
    tiltDeg: -3,
    label: "VENUS",
  },
  {
    name: "Earth",
    color: "#38bdf8",
    glowColor: "#0ea5e9",
    radius: 8.5,
    orbitRx: 215,
    orbitRy: 104,
    speed: 0.32,
    angle: 4.3,
    tiltDeg: 0,
    label: "EARTH",
    hasMoon: true,
  },
  {
    name: "Mars",
    color: "#f87171",
    glowColor: "#ea580c",
    radius: 6.5,
    orbitRx: 280,
    orbitRy: 136,
    speed: 0.22,
    angle: 1.1,
    tiltDeg: 4,
    label: "MARS",
  },
  {
    name: "Jupiter",
    color: "#fb923c",
    glowColor: "#fde047",
    radius: 15,
    orbitRx: 365,
    orbitRy: 176,
    speed: 0.12,
    angle: 5.7,
    tiltDeg: -4,
    label: "JUPITER",
  },
  {
    name: "Saturn",
    color: "#facc15",
    glowColor: "#ca8a04",
    radius: 12.5,
    orbitRx: 450,
    orbitRy: 216,
    speed: 0.082,
    angle: 3.5,
    tiltDeg: 6,
    label: "SATURN",
    hasRings: true,
    ringsRadius: 22,
  },
  {
    name: "Uranus",
    color: "#38bdf8",
    glowColor: "#06b6d4",
    radius: 9.5,
    orbitRx: 530,
    orbitRy: 254,
    speed: 0.052,
    angle: 0.9,
    tiltDeg: -7,
    label: "URANUS",
  },
  {
    name: "Neptune",
    color: "#818cf8",
    glowColor: "#6366f1",
    radius: 9.0,
    orbitRx: 605,
    orbitRy: 288,
    speed: 0.038,
    angle: 2.8,
    tiltDeg: 3,
    label: "NEPTUNE",
  },
];

interface Asteroid {
  angle: number;
  rDist: number;
  speed: number;
  size: number;
  alpha: number;
}

export default function SolarSystemHeroBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  const planetsRef = useRef<Planet[]>(
    PLANETS.map((p) => ({ ...p }))
  );
  const asteroidsRef = useRef<Asteroid[]>([]);

  useEffect(() => {
    // Generate asteroid belt
    const asts: Asteroid[] = [];
    for (let i = 0; i < 180; i++) {
      const rDist = 320 + (Math.random() - 0.5) * 45;
      asts.push({
        angle: Math.random() * Math.PI * 2,
        rDist,
        speed: 0.15 + (Math.random() - 0.5) * 0.04,
        size: Math.random() * 1.4 + 0.5,
        alpha: Math.random() * 0.45 + 0.15,
      });
    }
    asteroidsRef.current = asts;
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: (e.clientY / window.innerHeight) * 2 - 1,
      };
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let lastTime = performance.now();

    function resize() {
      if (!canvas) return;
      const rect = containerRef.current?.getBoundingClientRect();
      const width = (rect && rect.width > 0) ? rect.width : window.innerWidth;
      const height = (rect && rect.height > 0) ? rect.height : Math.max(window.innerHeight - 60, 600);
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    resize();
    window.addEventListener("resize", resize);

    const ro = typeof ResizeObserver !== "undefined" && containerRef.current
      ? new ResizeObserver(resize)
      : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);

    function render(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const dpr = window.devicePixelRatio || 1;
      const W = canvas!.width / dpr;
      const H = canvas!.height / dpr;

      if (W <= 10 || H <= 10) {
        resize();
        animId = requestAnimationFrame(render);
        return;
      }

      ctx!.save();
      ctx!.scale(dpr, dpr);
      ctx!.clearRect(0, 0, W, H);

      // Center of Solar System
      const mouse = mouseRef.current;
      const cx = W / 2 + mouse.x * 14;
      const cy = H * 0.44 + mouse.y * 10;

      const scale = Math.min(W / 1250, H / 680, 1.0) * 0.96;

      // ── 1. Sun & Solar Corona ─────────────────────────────────────────
      const sunPulse = 1 + Math.sin(now * 0.0025) * 0.05;
      const sunR = 25 * scale * sunPulse;

      // Outer golden solar corona glow
      const corona = ctx!.createRadialGradient(cx, cy, sunR * 0.5, cx, cy, 210 * scale);
      corona.addColorStop(0, "rgba(255, 190, 50, 0.35)");
      corona.addColorStop(0.25, "rgba(255, 110, 20, 0.18)");
      corona.addColorStop(0.60, "rgba(255, 50, 0, 0.05)");
      corona.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx!.fillStyle = corona;
      ctx!.beginPath();
      ctx!.arc(cx, cy, 210 * scale, 0, Math.PI * 2);
      ctx!.fill();

      // Sun flares
      ctx!.save();
      ctx!.translate(cx, cy);
      ctx!.rotate(now * 0.0003);
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI * 2) / 12;
        const len = 48 * scale + Math.sin(now * 0.004 + i) * 12 * scale;
        ctx!.strokeStyle = "rgba(255, 190, 50, 0.25)";
        ctx!.lineWidth = 1.2;
        ctx!.beginPath();
        ctx!.moveTo(Math.cos(a) * (sunR * 0.9), Math.sin(a) * (sunR * 0.9));
        ctx!.lineTo(Math.cos(a) * (sunR + len), Math.sin(a) * (sunR + len));
        ctx!.stroke();
      }
      ctx!.restore();

      // Sun core
      const sunCore = ctx!.createRadialGradient(cx - sunR * 0.3, cy - sunR * 0.3, 0, cx, cy, sunR);
      sunCore.addColorStop(0, "#ffffff");
      sunCore.addColorStop(0.35, "#fef08a");
      sunCore.addColorStop(0.7, "#f59e0b");
      sunCore.addColorStop(1, "#d97706");

      ctx!.fillStyle = sunCore;
      ctx!.beginPath();
      ctx!.arc(cx, cy, sunR, 0, Math.PI * 2);
      ctx!.fill();

      ctx!.shadowColor = "#f59e0b";
      ctx!.shadowBlur = 30;
      ctx!.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx!.lineWidth = 1.2;
      ctx!.stroke();
      ctx!.shadowBlur = 0;

      // ── 2. Orbital Ellipses & Telemetry Marks ─────────────────────────
      planetsRef.current.forEach((planet) => {
        const rx = planet.orbitRx * scale;
        const ry = planet.orbitRy * scale;
        const tiltRad = (planet.tiltDeg * Math.PI) / 180;

        ctx!.save();
        ctx!.translate(cx, cy);
        ctx!.rotate(tiltRad);

        ctx!.beginPath();
        ctx!.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx!.strokeStyle = "rgba(96, 165, 250, 0.32)";
        ctx!.lineWidth = 0.9;
        ctx!.setLineDash([4, 6]);
        ctx!.stroke();

        ctx!.restore();
      });

      // ── 3. Asteroid Belt ─────────────────────────────────────────────
      asteroidsRef.current.forEach((ast) => {
        ast.angle += ast.speed * dt * 0.18;
        const aRx = ast.rDist * scale;
        const aRy = ast.rDist * 0.48 * scale;
        const ax = cx + aRx * Math.cos(ast.angle);
        const ay = cy + aRy * Math.sin(ast.angle);

        ctx!.fillStyle = `rgba(180, 195, 220, ${ast.alpha})`;
        ctx!.beginPath();
        ctx!.arc(ax, ay, ast.size * scale, 0, Math.PI * 2);
        ctx!.fill();
      });

      // ── 4. Earth-Mars Transfer Trajectory Arc ─────────────────────────
      const earth = planetsRef.current.find((p) => p.name === "Earth");
      const mars = planetsRef.current.find((p) => p.name === "Mars");

      if (earth && mars) {
        const earthTilt = (earth.tiltDeg * Math.PI) / 180;
        const elx = earth.orbitRx * scale * Math.cos(earth.angle);
        const ely = earth.orbitRy * scale * Math.sin(earth.angle);
        const epx = cx + elx * Math.cos(earthTilt) - ely * Math.sin(earthTilt);
        const epy = cy + elx * Math.sin(earthTilt) + ely * Math.cos(earthTilt);

        const marsTilt = (mars.tiltDeg * Math.PI) / 180;
        const mlx = mars.orbitRx * scale * Math.cos(mars.angle);
        const mly = mars.orbitRy * scale * Math.sin(mars.angle);
        const mpx = cx + mlx * Math.cos(marsTilt) - mly * Math.sin(marsTilt);
        const mpy = cy + mlx * Math.sin(marsTilt) + mly * Math.cos(marsTilt);

        ctx!.save();
        ctx!.strokeStyle = "rgba(56, 189, 248, 0.4)";
        ctx!.lineWidth = 1.2;
        ctx!.setLineDash([4, 4]);

        const midX = (epx + mpx) / 2 + (mpy - epy) * 0.25;
        const midY = (epy + mpy) / 2 - (mpx - epx) * 0.25;

        ctx!.beginPath();
        ctx!.moveTo(epx, epy);
        ctx!.quadraticCurveTo(midX, midY, mpx, mpy);
        ctx!.stroke();

        // Traveling spacecraft pulse
        const tPhase = (now * 0.0008) % 1;
        const scx = (1 - tPhase) * (1 - tPhase) * epx + 2 * (1 - tPhase) * tPhase * midX + tPhase * tPhase * mpx;
        const scy = (1 - tPhase) * (1 - tPhase) * epy + 2 * (1 - tPhase) * tPhase * midY + tPhase * tPhase * mpy;

        ctx!.fillStyle = "#38bdf8";
        ctx!.shadowColor = "#38bdf8";
        ctx!.shadowBlur = 8;
        ctx!.beginPath();
        ctx!.arc(scx, scy, 2.8, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.restore();
      }

      // ── 5. Planets & Moons ───────────────────────────────────────────
      planetsRef.current.forEach((planet) => {
        planet.angle += planet.speed * dt * 0.22;

        const rx = planet.orbitRx * scale;
        const ry = planet.orbitRy * scale;
        const tiltRad = (planet.tiltDeg * Math.PI) / 180;

        const lx = rx * Math.cos(planet.angle);
        const ly = ry * Math.sin(planet.angle);
        const px = cx + lx * Math.cos(tiltRad) - ly * Math.sin(tiltRad);
        const py = cy + lx * Math.sin(tiltRad) + ly * Math.cos(tiltRad);

        const pRadius = Math.max(planet.radius * scale, 3.5);

        // Halo
        const halo = ctx!.createRadialGradient(px, py, pRadius * 0.5, px, py, pRadius * 2.8);
        halo.addColorStop(0, `${planet.glowColor}66`);
        halo.addColorStop(0.5, `${planet.glowColor}20`);
        halo.addColorStop(1, "rgba(0,0,0,0)");
        ctx!.fillStyle = halo;
        ctx!.beginPath();
        ctx!.arc(px, py, pRadius * 2.8, 0, Math.PI * 2);
        ctx!.fill();

        // Saturn Rings
        if (planet.hasRings && planet.ringsRadius) {
          ctx!.save();
          ctx!.translate(px, py);
          ctx!.rotate(0.35);
          ctx!.scale(1, 0.38);

          ctx!.strokeStyle = "rgba(234, 179, 8, 0.85)";
          ctx!.lineWidth = 4.0 * scale;
          ctx!.beginPath();
          ctx!.arc(0, 0, planet.ringsRadius * scale, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.restore();
        }

        // Planet Sphere with 3D Sun Lighting
        const lightAngle = Math.atan2(cy - py, cx - px);
        const lxOffset = Math.cos(lightAngle) * (pRadius * 0.4);
        const lyOffset = Math.sin(lightAngle) * (pRadius * 0.4);

        const planetGrad = ctx!.createRadialGradient(
          px + lxOffset,
          py + lyOffset,
          pRadius * 0.1,
          px,
          py,
          pRadius
        );
        planetGrad.addColorStop(0, "#ffffff");
        planetGrad.addColorStop(0.35, planet.color);
        planetGrad.addColorStop(0.85, planet.color);
        planetGrad.addColorStop(1, "#030712");

        ctx!.fillStyle = planetGrad;
        ctx!.beginPath();
        ctx!.arc(px, py, pRadius, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.strokeStyle = `${planet.glowColor}cc`;
        ctx!.lineWidth = 0.8;
        ctx!.stroke();

        // Planet Label
        ctx!.fillStyle = "rgba(220, 235, 255, 0.85)";
        ctx!.font = "9px monospace";
        ctx!.textAlign = "center";
        ctx!.fillText(planet.name.toUpperCase(), px, py - pRadius - 4);

        // Moon
        if (planet.hasMoon) {
          const moonAngle = now * 0.003;
          const moonDist = pRadius + 9 * scale;
          const mx = px + Math.cos(moonAngle) * moonDist;
          const my = py + Math.sin(moonAngle) * (moonDist * 0.5);

          ctx!.fillStyle = "#e2e8f0";
          ctx!.beginPath();
          ctx!.arc(mx, my, 1.8 * scale, 0, Math.PI * 2);
          ctx!.fill();
        }
      });

      // Restore root canvas transformation
      ctx!.restore();

      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      if (ro) ro.disconnect();
    };
  }, []);

  return (
    <div className={styles.solarBackgroundContainer} ref={containerRef} aria-hidden="true">
      <canvas ref={canvasRef} className={styles.solarCanvas} />
    </div>
  );
}

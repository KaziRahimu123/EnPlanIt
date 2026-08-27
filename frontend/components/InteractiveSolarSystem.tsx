"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import styles from "./InteractiveSolarSystem.module.css";

export interface PlanetData {
  id: string;
  name: string;
  color: string;
  glowColor: string;
  radius: number;          // Visual radius in px
  orbitRx: number;        // Orbit X radius in px (scaled dynamically)
  orbitRy: number;        // Orbit Y radius in px (scaled dynamically)
  speed: number;          // Rad/sec orbital speed
  initialAngle: number;   // Starting angle
  tiltDeg: number;        // Orbital inclination tilt
  distAU: string;         // Distance from sun
  orbitalPeriod: string;  // Period
  velocityKmS: string;    // Orbital velocity
  temp: string;           // Temperature
  moons: number;
  missionTarget: string;  // Active mission / AstroOps designation
  description: string;
  hasRings?: boolean;
  ringsRadius?: number;
}

export const PLANETS: PlanetData[] = [
  {
    id: "mercury",
    name: "Mercury",
    color: "#b09e8b",
    glowColor: "#f59e0b",
    radius: 4,
    orbitRx: 110,
    orbitRy: 52,
    speed: 0.65,
    initialAngle: 0.5,
    tiltDeg: -6,
    distAU: "0.39 AU",
    orbitalPeriod: "88 Days",
    velocityKmS: "47.4 km/s",
    temp: "167°C",
    moons: 0,
    missionTarget: "Solar Boundary Probe / BepiColombo",
    description: "Extreme thermal gradients & solar radiation testing zone",
  },
  {
    id: "venus",
    name: "Venus",
    color: "#e2b872",
    glowColor: "#fbbf24",
    radius: 6.5,
    orbitRx: 165,
    orbitRy: 78,
    speed: 0.42,
    initialAngle: 2.2,
    tiltDeg: -3,
    distAU: "0.72 AU",
    orbitalPeriod: "225 Days",
    velocityKmS: "35.0 km/s",
    temp: "464°C",
    moons: 0,
    missionTarget: "DAVINCI / VERITAS EnVision Target",
    description: "Dense supercritical CO2 atmosphere & extreme greenhouse modeling",
  },
  {
    id: "earth",
    name: "Earth",
    color: "#4ba3e3",
    glowColor: "#38bdf8",
    radius: 7.5,
    orbitRx: 225,
    orbitRy: 106,
    speed: 0.30,
    initialAngle: 4.3,
    tiltDeg: 0,
    distAU: "1.00 AU",
    orbitalPeriod: "365.2 Days",
    velocityKmS: "29.8 km/s",
    temp: "15°C",
    moons: 1,
    missionTarget: "Primary Mission Launch Origin & LEO/GEO Gateway",
    description: "Baseline mission origin & deep space comms ground array link",
  },
  {
    id: "mars",
    name: "Mars",
    color: "#ef4444",
    glowColor: "#f97316",
    radius: 5.5,
    orbitRx: 295,
    orbitRy: 140,
    speed: 0.20,
    initialAngle: 1.1,
    tiltDeg: 4,
    distAU: "1.52 AU",
    orbitalPeriod: "687 Days",
    velocityKmS: "24.1 km/s",
    temp: "-65°C",
    moons: 2,
    missionTarget: "Primary Crewed Landing & Exploration Horizon",
    description: "Target destination for human settlement and autonomous sample return",
  },
  {
    id: "jupiter",
    name: "Jupiter",
    color: "#d97706",
    glowColor: "#fde047",
    radius: 14,
    orbitRx: 380,
    orbitRy: 180,
    speed: 0.11,
    initialAngle: 5.7,
    tiltDeg: -4,
    distAU: "5.20 AU",
    orbitalPeriod: "11.86 Yrs",
    velocityKmS: "13.1 km/s",
    temp: "-110°C",
    moons: 95,
    missionTarget: "JUICE / Europa Clipper Gravity Assist Hub",
    description: "Gas giant gravity accelerator & radiation-hardened icy moon explorer",
  },
  {
    id: "saturn",
    name: "Saturn",
    color: "#eab308",
    glowColor: "#ca8a04",
    radius: 11.5,
    orbitRx: 465,
    orbitRy: 220,
    speed: 0.075,
    initialAngle: 3.5,
    tiltDeg: 6,
    hasRings: true,
    ringsRadius: 21,
    distAU: "9.58 AU",
    orbitalPeriod: "29.45 Yrs",
    velocityKmS: "9.7 km/s",
    temp: "-140°C",
    moons: 146,
    missionTarget: "Dragonfly Titan Exploration Target",
    description: "Complex ring system dynamics and prebiotic ocean moon exploration",
  },
  {
    id: "uranus",
    name: "Uranus",
    color: "#38bdf8",
    glowColor: "#06b6d4",
    radius: 8.5,
    orbitRx: 545,
    orbitRy: 258,
    speed: 0.048,
    initialAngle: 0.9,
    tiltDeg: -7,
    distAU: "19.2 AU",
    orbitalPeriod: "84.0 Yrs",
    velocityKmS: "6.8 km/s",
    temp: "-195°C",
    moons: 28,
    missionTarget: "Uranus Orbiter & Atmospheric Probe Concept",
    description: "Tilted ice giant magnetosphere and extreme retrograde axial tilt",
  },
  {
    id: "neptune",
    name: "Neptune",
    color: "#6366f1",
    glowColor: "#818cf8",
    radius: 8.0,
    orbitRx: 620,
    orbitRy: 294,
    speed: 0.034,
    initialAngle: 2.8,
    tiltDeg: 3,
    distAU: "30.1 AU",
    orbitalPeriod: "164.8 Yrs",
    velocityKmS: "5.4 km/s",
    temp: "-200°C",
    moons: 16,
    missionTarget: "Triton Cryovolcanism & Kuiper Frontier Link",
    description: "Supersonic atmospheric winds, dark storm vortices & deep frontier",
  },
];

interface Asteroid {
  angle: number;
  rDist: number;
  rNorm: number;
  speed: number;
  size: number;
  alpha: number;
}

export default function InteractiveSolarSystem({
  selectedPlanet,
  onSelectPlanet,
}: {
  selectedPlanet?: string | null;
  onSelectPlanet?: (planet: PlanetData | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredPlanet, setHoveredPlanet] = useState<PlanetData | null>(null);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [isPaused, setIsPaused] = useState(false);

  // Position coordinates state for HTML overlay tooltips
  const planetPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const anglesRef = useRef<Record<string, number>>(
    PLANETS.reduce((acc, p) => ({ ...acc, [p.id]: p.initialAngle }), {})
  );

  const asteroidsRef = useRef<Asteroid[]>([]);

  // Initialize Asteroid Belt between Mars (295) and Jupiter (380)
  useEffect(() => {
    const asteroids: Asteroid[] = [];
    for (let i = 0; i < 220; i++) {
      const rFraction = Math.random();
      const rDist = 325 + (rFraction - 0.5) * 55; // 298..352
      asteroids.push({
        angle: Math.random() * Math.PI * 2,
        rDist,
        rNorm: rDist / 325,
        speed: (0.16 + (Math.random() - 0.5) * 0.04) * (Math.random() > 0.5 ? 1 : 1),
        size: Math.random() * 1.4 + 0.5,
        alpha: Math.random() * 0.45 + 0.15,
      });
    }
    asteroidsRef.current = asteroids;
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      let found: PlanetData | null = null;
      for (const p of PLANETS) {
        const pos = planetPositionsRef.current[p.id];
        if (!pos) continue;
        const dist = Math.hypot(clickX - pos.x, clickY - pos.y);
        if (dist <= Math.max(p.radius * 2.2, 18)) {
          found = p;
          break;
        }
      }

      if (onSelectPlanet) {
        onSelectPlanet(found === selectedPlanet ? null : found);
      }
    },
    [onSelectPlanet, selectedPlanet]
  );

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let found: PlanetData | null = null;
    for (const p of PLANETS) {
      const pos = planetPositionsRef.current[p.id];
      if (!pos) continue;
      const dist = Math.hypot(mouseX - pos.x, mouseY - pos.y);
      if (dist <= Math.max(p.radius * 2.2, 18)) {
        found = p;
        break;
      }
    }
    setHoveredPlanet(found);
  }, []);

  // Main Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let lastTime = performance.now();

    function resize() {
      if (!canvas || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }

    resize();
    window.addEventListener("resize", resize);

    function render(now: number) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const dpr = window.devicePixelRatio || 1;
      const W = canvas!.width / dpr;
      const H = canvas!.height / dpr;

      ctx!.save();
      ctx!.scale(dpr, dpr);
      ctx!.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;

      // Dynamic scale factor based on screen width
      const scale = Math.min(W / 1400, H / 750, 1.0) * 0.95;

      // ── 1. Sun Glow & Flares ─────────────────────────────────────────
      const sunPulse = 1 + Math.sin(now * 0.0025) * 0.06;
      const sunR = 24 * scale * sunPulse;

      // Massive outer solar corona
      const coronaGrad = ctx!.createRadialGradient(cx, cy, sunR * 0.6, cx, cy, 180 * scale);
      coronaGrad.addColorStop(0, "rgba(255, 200, 50, 0.45)");
      coronaGrad.addColorStop(0.25, "rgba(255, 120, 20, 0.22)");
      coronaGrad.addColorStop(0.55, "rgba(255, 60, 0, 0.08)");
      coronaGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx!.fillStyle = coronaGrad;
      ctx!.beginPath();
      ctx!.arc(cx, cy, 180 * scale, 0, Math.PI * 2);
      ctx!.fill();

      // Sun rays / solar flares
      ctx!.save();
      ctx!.translate(cx, cy);
      ctx!.rotate(now * 0.0003);
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI * 2) / 12;
        const len = 50 * scale + Math.sin(now * 0.004 + i) * 12 * scale;
        ctx!.strokeStyle = "rgba(255, 180, 40, 0.12)";
        ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        ctx!.moveTo(Math.cos(angle) * (sunR * 0.9), Math.sin(angle) * (sunR * 0.9));
        ctx!.lineTo(Math.cos(angle) * (sunR + len), Math.sin(angle) * (sunR + len));
        ctx!.stroke();
      }
      ctx!.restore();

      // Sun core
      const sunCoreGrad = ctx!.createRadialGradient(cx - sunR * 0.3, cy - sunR * 0.3, 0, cx, cy, sunR);
      sunCoreGrad.addColorStop(0, "#ffffff");
      sunCoreGrad.addColorStop(0.3, "#fef08a");
      sunCoreGrad.addColorStop(0.7, "#f59e0b");
      sunCoreGrad.addColorStop(1, "#d97706");

      ctx!.fillStyle = sunCoreGrad;
      ctx!.beginPath();
      ctx!.arc(cx, cy, sunR, 0, Math.PI * 2);
      ctx!.fill();

      ctx!.shadowColor = "#f59e0b";
      ctx!.shadowBlur = 24;
      ctx!.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx!.lineWidth = 1;
      ctx!.stroke();
      ctx!.shadowBlur = 0;

      // ── 2. Orbital Ellipses ──────────────────────────────────────────
      PLANETS.forEach((planet) => {
        const isHovered = hoveredPlanet?.id === planet.id;
        const isSelected = selectedPlanet === planet.id;
        const rx = planet.orbitRx * scale;
        const ry = planet.orbitRy * scale;
        const tiltRad = (planet.tiltDeg * Math.PI) / 180;

        ctx!.save();
        ctx!.translate(cx, cy);
        ctx!.rotate(tiltRad);

        ctx!.beginPath();
        ctx!.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);

        if (isSelected) {
          ctx!.strokeStyle = planet.glowColor;
          ctx!.lineWidth = 2.0;
          ctx!.setLineDash([6, 6]);
          ctx!.shadowColor = planet.glowColor;
          ctx!.shadowBlur = 12;
        } else if (isHovered) {
          ctx!.strokeStyle = planet.glowColor;
          ctx!.lineWidth = 1.4;
          ctx!.setLineDash([4, 6]);
          ctx!.shadowColor = planet.glowColor;
          ctx!.shadowBlur = 8;
        } else {
          ctx!.strokeStyle = "rgba(70, 140, 240, 0.16)";
          ctx!.lineWidth = 0.8;
          ctx!.setLineDash([2, 8]);
          ctx!.shadowBlur = 0;
        }

        ctx!.stroke();
        ctx!.restore();
      });

      // ── 3. Asteroid Belt ─────────────────────────────────────────────
      asteroidsRef.current.forEach((ast) => {
        if (!isPaused) {
          ast.angle += ast.speed * dt * 0.15 * speedMultiplier;
        }
        const aRx = ast.rDist * scale;
        const aRy = ast.rDist * 0.48 * scale;
        const ax = cx + aRx * Math.cos(ast.angle);
        const ay = cy + aRy * Math.sin(ast.angle);

        ctx!.fillStyle = `rgba(180, 195, 220, ${ast.alpha})`;
        ctx!.beginPath();
        ctx!.arc(ax, ay, ast.size * scale, 0, Math.PI * 2);
        ctx!.fill();
      });

      // ── 4. Hohmann Transfer Trajectory Arc (if a target is selected) ──
      if (selectedPlanet && selectedPlanet !== "earth") {
        const earthPos = planetPositionsRef.current["earth"];
        const targetPos = planetPositionsRef.current[selectedPlanet];
        if (earthPos && targetPos) {
          ctx!.save();
          ctx!.strokeStyle = "rgba(56, 189, 248, 0.75)";
          ctx!.lineWidth = 1.6;
          ctx!.setLineDash([5, 5]);
          ctx!.shadowColor = "#38bdf8";
          ctx!.shadowBlur = 10;

          ctx!.beginPath();
          ctx!.moveTo(earthPos.x, earthPos.y);
          const midX = (earthPos.x + targetPos.x) / 2 + (targetPos.y - earthPos.y) * 0.25;
          const midY = (earthPos.y + targetPos.y) / 2 - (targetPos.x - earthPos.x) * 0.25;
          ctx!.quadraticCurveTo(midX, midY, targetPos.x, targetPos.y);
          ctx!.stroke();

          // Animated transfer pulse packet
          const packetPhase = (now * 0.001) % 1;
          const t = packetPhase;
          const px = (1 - t) * (1 - t) * earthPos.x + 2 * (1 - t) * t * midX + t * t * targetPos.x;
          const py = (1 - t) * (1 - t) * earthPos.y + 2 * (1 - t) * t * midY + t * t * targetPos.y;

          ctx!.fillStyle = "#38bdf8";
          ctx!.shadowColor = "#ffffff";
          ctx!.shadowBlur = 8;
          ctx!.beginPath();
          ctx!.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.restore();
        }
      }

      // ── 5. Planets & Moons ───────────────────────────────────────────
      PLANETS.forEach((planet) => {
        if (!isPaused) {
          anglesRef.current[planet.id] =
            (anglesRef.current[planet.id] || planet.initialAngle) +
            planet.speed * dt * 0.22 * speedMultiplier;
        }

        const angle = anglesRef.current[planet.id];
        const rx = planet.orbitRx * scale;
        const ry = planet.orbitRy * scale;
        const tiltRad = (planet.tiltDeg * Math.PI) / 180;

        // Parametric ellipse with tilt
        const lx = rx * Math.cos(angle);
        const ly = ry * Math.sin(angle);
        const px = cx + lx * Math.cos(tiltRad) - ly * Math.sin(tiltRad);
        const py = cy + lx * Math.sin(tiltRad) + ly * Math.cos(tiltRad);

        // Store positions for tooltip & click detection
        planetPositionsRef.current[planet.id] = { x: px, y: py };

        const isHovered = hoveredPlanet?.id === planet.id;
        const isSelected = selectedPlanet === planet.id;
        const pRadius = Math.max(planet.radius * scale, 3.5);

        // Target Lock Reticle
        if (isSelected || isHovered) {
          ctx!.save();
          ctx!.strokeStyle = planet.glowColor;
          ctx!.lineWidth = 1.2;
          ctx!.setLineDash([]);
          const reticleR = pRadius + 8;

          // Corner brackets
          const bLen = Math.PI / 4;
          for (let k = 0; k < 4; k++) {
            const bAngle = (k * Math.PI) / 2;
            ctx!.beginPath();
            ctx!.arc(px, py, reticleR, bAngle - bLen / 2, bAngle + bLen / 2);
            ctx!.stroke();
          }

          // Label
          ctx!.fillStyle = "#ffffff";
          ctx!.font = "bold 11px monospace";
          ctx!.textAlign = "center";
          ctx!.fillText(planet.name.toUpperCase(), px, py - reticleR - 5);
          ctx!.restore();
        }

        // Atmospheric Halo
        const haloGrad = ctx!.createRadialGradient(px, py, pRadius * 0.6, px, py, pRadius * 2.8);
        haloGrad.addColorStop(0, `${planet.glowColor}66`);
        haloGrad.addColorStop(0.5, `${planet.glowColor}22`);
        haloGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx!.fillStyle = haloGrad;
        ctx!.beginPath();
        ctx!.arc(px, py, pRadius * 2.8, 0, Math.PI * 2);
        ctx!.fill();

        // Saturn Rings (drawn behind planet first, then top)
        if (planet.hasRings && planet.ringsRadius) {
          ctx!.save();
          ctx!.translate(px, py);
          ctx!.rotate(0.35);
          ctx!.scale(1, 0.38);

          ctx!.strokeStyle = "rgba(234, 179, 8, 0.75)";
          ctx!.lineWidth = 3.5 * scale;
          ctx!.beginPath();
          ctx!.arc(0, 0, planet.ringsRadius * scale, 0, Math.PI * 2);
          ctx!.stroke();

          ctx!.strokeStyle = "rgba(253, 224, 71, 0.4)";
          ctx!.lineWidth = 1.5 * scale;
          ctx!.beginPath();
          ctx!.arc(0, 0, (planet.ringsRadius + 3) * scale, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.restore();
        }

        // Planet Body with 3D spherical lighting from center Sun
        const lightAngle = Math.atan2(cy - py, cx - px);
        const lightDist = Math.hypot(cx - px, cy - py);
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
        planetGrad.addColorStop(0.3, planet.color);
        planetGrad.addColorStop(0.85, planet.color);
        planetGrad.addColorStop(1, "#030712");

        ctx!.fillStyle = planetGrad;
        ctx!.beginPath();
        ctx!.arc(px, py, pRadius, 0, Math.PI * 2);
        ctx!.fill();

        // Atmospheric rim
        ctx!.strokeStyle = `${planet.glowColor}bb`;
        ctx!.lineWidth = 1;
        ctx!.stroke();

        // Earth's Moon
        if (planet.id === "earth") {
          const moonAngle = now * 0.003;
          const moonDist = pRadius + 9 * scale;
          const mx = px + Math.cos(moonAngle) * moonDist;
          const my = py + Math.sin(moonAngle) * (moonDist * 0.5);

          ctx!.fillStyle = "#cbd5e1";
          ctx!.beginPath();
          ctx!.arc(mx, my, 1.8 * scale, 0, Math.PI * 2);
          ctx!.fill();
        }
      });

      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [hoveredPlanet, selectedPlanet, speedMultiplier, isPaused]);

  return (
    <div className={styles.solarContainer} ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={styles.solarCanvas}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={() => setHoveredPlanet(null)}
      />

      {/* ── Solar System Interactive HUD Bar ────────────────────────────── */}
      <div className={styles.hudBar}>
        <div className="flex items-center gap-2">
          <span className={styles.hudDot} />
          <span className="text-[10px] font-mono text-[var(--accent-glow)] uppercase tracking-wider">
            Solar System Telemetry Orrery
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPaused((p) => !p)}
            className={styles.hudBtn}
            title={isPaused ? "Resume Orbit Simulation" : "Pause Orbit Simulation"}
          >
            {isPaused ? "▶ PLAY" : "⏸ PAUSE"}
          </button>

          <button
            type="button"
            onClick={() => setSpeedMultiplier((s) => (s === 1 ? 2.5 : s === 2.5 ? 5 : 1))}
            className={`${styles.hudBtn} ${speedMultiplier > 1 ? styles.hudBtnActive : ""}`}
            title="Cycle orbital speed"
          >
            {speedMultiplier}x WARP
          </button>

          {selectedPlanet && (
            <button
              type="button"
              onClick={() => onSelectPlanet && onSelectPlanet(null)}
              className={styles.hudBtnClear}
            >
              ✕ Clear Target
            </button>
          )}
        </div>
      </div>

      {/* ── Interactive Target Telemetry Popup ─────────────────────────── */}
      {(hoveredPlanet || (selectedPlanet && PLANETS.find((p) => p.id === selectedPlanet))) && (
        (() => {
          const p = (hoveredPlanet || PLANETS.find((x) => x.id === selectedPlanet))!;
          const isTargeted = selectedPlanet === p.id;
          return (
            <div className={`${styles.telemetryCard} ${isTargeted ? styles.telemetryCardTargeted : ""}`}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0 shadow-lg" style={{ background: p.color, boxShadow: `0 0 10px ${p.glowColor}` }} />
                  <span className="font-bold text-sm text-white font-mono uppercase tracking-wide">
                    {p.name}
                  </span>
                </div>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent-glow)] border border-[var(--accent)]/30 uppercase">
                  {isTargeted ? "LOCKED TARGET" : "CLICK TO TARGET"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] font-mono mb-2.5">
                <div>
                  <span className="text-[var(--text-muted)]">Distance: </span>
                  <span className="text-white font-medium">{p.distAU}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Period: </span>
                  <span className="text-white font-medium">{p.orbitalPeriod}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Velocity: </span>
                  <span className="text-white font-medium">{p.velocityKmS}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Temp: </span>
                  <span className="text-white font-medium">{p.temp}</span>
                </div>
              </div>

              <div className="text-[10px] text-[var(--text-muted)] leading-relaxed border-t border-[var(--border)] pt-2 mb-2">
                {p.description}
              </div>

              <div className="flex items-center justify-between text-[9px] font-mono text-[var(--accent-glow)]">
                <span>🎯 {p.missionTarget}</span>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

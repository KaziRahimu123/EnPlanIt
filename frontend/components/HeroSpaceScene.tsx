"use client";

import { useEffect, useRef } from "react";
import styles from "./HeroSpaceScene.module.css";

/**
 * HeroSpaceScene — hero-only background layer.
 *
 * Renders (back → front):
 *   - Radial coordinate grid arcs (SVG)
 *   - 3 orbital trajectory ellipses (CSS)
 *   - HUD navigation rings (CSS)
 *   - Degree scale
 *   - Crosshair markers
 *   - Telemetry overlays (left + right)
 *   - Trajectory nominal badge
 *   - Mars destination marker
 *   - Waypoint dots
 *   - Spacecraft (JS-animated along blue orbit)
 *   - Earth horizon — dark CSS sphere + atmosphere glow
 *
 * Lives inside .hero which has overflow:hidden — Earth never bleeds out.
 * GlobalSpaceBackground (fixed canvas) handles stars for the full page.
 */
export default function HeroSpaceScene() {
  const scRef = useRef<HTMLDivElement>(null);
  const tRef  = useRef(Math.PI * 1.7);

  useEffect(() => {
    const sc = scRef.current;
    if (!sc) return;
    let raf: number;
    function step() {
      tRef.current += 0.000085;
      const t   = tRef.current;
      const a   = 0.48, b = 0.22, cx = 0.5, cy = 0.18;
      const ang = -10 * (Math.PI / 180);
      const px  = cx + (Math.cos(t) * a) * Math.cos(ang) - (Math.sin(t) * b) * Math.sin(ang);
      const py  = cy + (Math.cos(t) * a) * Math.sin(ang) + (Math.sin(t) * b) * Math.cos(ang);
      sc!.style.left = `${px * 100}%`;
      sc!.style.top  = `${py * 100}%`;
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={styles.scene} aria-hidden="true">

      {/* ── Coordinate grid arcs ─────────────────────────────────────── */}
      <svg className={styles.coordGrid} viewBox="0 0 1440 900"
           preserveAspectRatio="xMidYMid slice"
           xmlns="http://www.w3.org/2000/svg">
        {/* Radial arcs from top-center */}
        <g stroke="rgba(56,189,248,0.07)" strokeWidth="0.7" fill="none">
          <path d="M720 -80 A600 600 0 0 1 1320 520"/>
          <path d="M720 -80 A520 520 0 0 1 1240 440"/>
          <path d="M720 -80 A440 440 0 0 1 1160 360"/>
          <path d="M720 -80 A360 360 0 0 1 1080 280"/>
          <path d="M720 -80 A280 280 0 0 1 1000 200"/>
          <path d="M720 -80 A600 600 0 0 0 120 520"/>
          <path d="M720 -80 A520 520 0 0 0 200 440"/>
          <path d="M720 -80 A440 440 0 0 0 280 360"/>
          <path d="M720 -80 A360 360 0 0 0 360 280"/>
          <path d="M720 -80 A280 280 0 0 0 440 200"/>
        </g>
        {/* Degree labels */}
        <g fill="rgba(56,189,248,0.28)" fontFamily="inherit"
           fontSize="7.5" letterSpacing="0.08em">
          <text x="76"  y="370" transform="rotate(-30 76 370)">−150°</text>
          <text x="186" y="286" transform="rotate(-20 186 286)">−120°</text>
          <text x="316" y="220" transform="rotate(-10 316 220)">−90°</text>
          <text x="674" y="58">0°</text>
          <text x="1076" y="220" transform="rotate(10 1076 220)">+30°</text>
          <text x="1176" y="274" transform="rotate(18 1176 274)">+60°</text>
          <text x="1284" y="338" transform="rotate(25 1284 338)">+90°</text>
        </g>
        {/* Faint scan lines */}
        <g stroke="rgba(56,189,248,0.03)" strokeWidth="0.5" strokeDasharray="4 8">
          <line x1="0" y1="200" x2="1440" y2="200"/>
          <line x1="0" y1="340" x2="1440" y2="340"/>
          <line x1="0" y1="480" x2="1440" y2="480"/>
        </g>
      </svg>

      {/* ── Soft center glow behind title ────────────────────────────── */}
      <div className={styles.centerGlow} />

      {/* ── HUD navigation rings ─────────────────────────────────────── */}
      <div className={styles.hud}>
        <div className={`${styles.hudRing} ${styles.hudRingOuter}`} />
        <div className={`${styles.hudRing} ${styles.hudRingMiddle}`} />
        <div className={`${styles.hudRing} ${styles.hudRingInner}`} />
        <div className={styles.hudAxisVertical} />
        <div className={styles.hudAxisHorizontal} />
        <div className={styles.headingMarker} />
      </div>

      {/* ── Degree scale along upper HUD arc ─────────────────────────── */}
      <div className={styles.degreeScale}>
        {["-150°","-120°","-90°","-60°","-30°","0°","30°","60°","90°","120°","150°"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      {/* ── 3 orbital trajectories ───────────────────────────────────── */}
      <div className={`${styles.orbit} ${styles.orbitBlue}`} />
      <div className={`${styles.orbit} ${styles.orbitCyan}`} />
      <div className={`${styles.orbit} ${styles.orbitMars}`} />

      {/* ── Crosshair markers ────────────────────────────────────────── */}
      <div className={`${styles.crosshair} ${styles.crosshairLeft}`} />
      <div className={`${styles.crosshair} ${styles.crosshairRight}`} />

      {/* ── Left telemetry ───────────────────────────────────────────── */}
      <div className={styles.telemetryLeft}>
        <div>VECTOR 24.7°</div>
        <div>T+ 04:12:18</div>
        <div>LAT 28.572° N</div>
        <div>LON 80.649° W</div>
      </div>

      {/* ── Right telemetry ──────────────────────────────────────────── */}
      <div className={styles.telemetryRight}>
        <div>ALT 218 KM</div>
        <div>LINK 98%</div>
        <div>ORBIT LEO</div>
        <div>7.67 KM/S</div>
      </div>

      {/* ── Mars destination marker ──────────────────────────────────── */}
      <div className={styles.marsMarker}>
        <span className={styles.marsDot} />
        <div>
          <div>MARS</div>
          <strong>98%</strong>
        </div>
      </div>

      {/* ── Spacecraft — JS-animated ─────────────────────────────────── */}
      <div className={styles.spacecraft} ref={scRef}>✦</div>

      {/* ── Waypoints ────────────────────────────────────────────────── */}
      <div className={styles.waypointBlue} />
      <div className={styles.waypointCyan} />



    </div>
  );
}

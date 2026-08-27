"use client";

import styles from "./HomeEarthBackground.module.css";

/**
 * HomeEarthBackground — hero-only Earth horizon layer.
 *
 * Must be rendered ONLY inside the hero section.
 * The parent section must have: position:relative; overflow:hidden; isolation:isolate.
 * Earth is clipped at the section boundary — it never bleeds into lower sections.
 */
export default function HomeEarthBackground() {
  return (
    <div className={styles.spaceScene} aria-hidden="true">

      {/* Deep-space glow behind the hero title */}
      <div className={styles.spaceGlow} />

      {/* Star layers — 3 depths for parallax feel */}
      <div className={`${styles.stars} ${styles.starsFar}`} />
      <div className={`${styles.stars} ${styles.starsMid}`} />
      <div className={`${styles.stars} ${styles.starsNear}`} />

      {/* Orbital trajectory paths */}
      <div className={`${styles.orbit} ${styles.orbitOne}`} />
      <div className={`${styles.orbit} ${styles.orbitTwo}`} />
      <div className={`${styles.orbit} ${styles.orbitThree}`} />

      {/* Animated waypoint dot */}
      <div className={styles.waypoint} />

      {/* Earth — positioned mostly below the section, only horizon arc visible */}
      <div className={styles.earthWrapper}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/earth-night.jpg"
          alt=""
          className={styles.earth}
          draggable={false}
        />
        {/* Atmospheric rim overlaid on the image */}
        <div className={styles.atmosphere} />
      </div>

      {/* Smooth bottom fade into deep space background */}
      <div className={styles.bottomFade} />

      {/* Faint telemetry labels — outer edges only */}
      <div className={`${styles.telemetry} ${styles.telemetryLeft}`}>
        VECTOR 24.7°{"\n"}
        ALT 218 KM{"\n"}
        LINK 98%
      </div>
      <div className={`${styles.telemetry} ${styles.telemetryRight}`}>
        ORBIT LEO{"\n"}
        VELOCITY 7.67 KM/S{"\n"}
        TRAJECTORY NOMINAL
      </div>

    </div>
  );
}

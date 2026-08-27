"use client";

/**
 * ConditionalSpaceBackground — renders SpaceBackground on every page
 * EXCEPT the homepage ("/"), which uses GlobalSpaceBackground instead.
 */

import { usePathname } from "next/navigation";
import SpaceBackground from "./SpaceBackground";

export default function ConditionalSpaceBackground() {
  const pathname = usePathname();
  // Homepage uses GlobalSpaceBackground rendered inside page.tsx
  if (pathname === "/") return null;
  return <SpaceBackground />;
}

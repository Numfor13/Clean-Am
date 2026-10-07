"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { springDefault } from "@/lib/motion";

type Dir = "up" | "left" | "right";

// Where the element starts before it settles into place. "left"/"right" give a
// horizontal drift; "up" a vertical one — the mix the landing/home pages use.
const OFFSETS: Record<Dir, { x?: number; y?: number }> = {
  up: { y: 32 },
  left: { x: -40 },
  right: { x: 40 },
};

/**
 * Reveals its children once, the first time they scroll into view (Item 5).
 * Honours prefers-reduced-motion by rendering a plain div with no animation.
 * Keeps whatever className/style is passed, so it can stand in for an existing
 * styled wrapper (e.g. a grid child) without changing layout.
 */
export function Reveal({
  children,
  dir = "up",
  delay = 0,
  className,
  style,
}: {
  children: ReactNode;
  dir?: Dir;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, scale: 0.97, ...OFFSETS[dir] }}
      whileInView={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      // M3 Expressive default spatial spring: settles with a slight overshoot.
      transition={{ ...springDefault, delay, opacity: { duration: 0.3, delay } }}
    >
      {children}
    </motion.div>
  );
}

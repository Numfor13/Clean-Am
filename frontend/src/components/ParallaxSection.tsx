"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";

export interface ParallaxSectionProps {
  bgImage?: string;
  bgAlt?: string;
  bleedPercent?: number; // extra height percentage for vertical bleed (e.g. 25 = 125% height, -12.5% top)
  bgSpeed?: number; // relative shift magnitude in percent (e.g. 15 = moves from -15% to 15%)
  fgShift?: number; // px shift for foreground (e.g. 40 = moves from 40px to -40px)
  overlay?: boolean | string; // gradient or color overlay
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  minHeight?: string | number;
}

export function ParallaxSection({
  bgImage,
  bgAlt = "",
  bleedPercent = 30,
  bgSpeed = 16,
  fgShift = 30,
  overlay = true,
  children,
  className = "",
  style,
  minHeight = "480px",
}: ParallaxSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 300,
    damping: 35,
    restDelta: 0.001,
  });

  // Background moves opposite to scroll to create depth
  const bgY = useTransform(smoothProgress, [0, 1], [`-${bgSpeed}%`, `${bgSpeed}%`]);
  // Foreground moves slightly faster
  const fgY = useTransform(smoothProgress, [0, 1], [`${fgShift}px`, `-${fgShift}px`]);

  const heightVal = `${100 + bleedPercent}%`;
  const topVal = `-${bleedPercent / 2}%`;

  return (
    <section
      ref={containerRef}
      className={`parallax-section ${className}`}
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {bgImage ? (
        <motion.div
          className="parallax-bg-layer"
          style={{
            position: "absolute",
            left: 0,
            top: topVal,
            width: "100%",
            height: heightVal,
            y: bgY,
            willChange: "transform",
            transform: "translate3d(0, 0, 0)",
            WebkitBackfaceVisibility: "hidden",
            backfaceVisibility: "hidden",
            zIndex: 1,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bgImage}
            alt={bgAlt}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              display: "block",
            }}
          />
        </motion.div>
      ) : null}

      {overlay ? (
        <div
          className="parallax-overlay"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background:
              typeof overlay === "string"
                ? overlay
                : "linear-gradient(180deg, rgba(6, 24, 13, 0.72) 0%, rgba(6, 24, 13, 0.55) 50%, rgba(6, 24, 13, 0.85) 100%)",
            zIndex: 2,
            pointerEvents: "none",
          }}
        />
      ) : null}

      <motion.div
        className="parallax-content"
        style={{
          position: "relative",
          zIndex: 3,
          width: "100%",
          y: fgY,
          willChange: "transform",
          transform: "translate3d(0, 0, 0)",
          WebkitBackfaceVisibility: "hidden",
          backfaceVisibility: "hidden",
        }}
      >
        {children}
      </motion.div>
    </section>
  );
}

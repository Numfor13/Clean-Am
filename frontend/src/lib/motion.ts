// Material 3 Expressive motion as framer-motion springs. These are the same
// springs the CSS curves in styles/tokens.css were sampled from, so a reveal
// animated here and a button animated in CSS move the same way.

import type { Transition } from "framer-motion";

/** Small elements: chips, buttons, indicators. Overshoots a little. */
export const springFast: Transition = { type: "spring", stiffness: 1400, damping: 45, mass: 1 };

/** Cards and sections settling into place. */
export const springDefault: Transition = { type: "spring", stiffness: 700, damping: 40, mass: 1 };

/** Large surfaces: hero panels, sheets, full-bleed images. */
export const springSlow: Transition = { type: "spring", stiffness: 300, damping: 28, mass: 1 };

/** Opacity and colour: never overshoots. */
export const springEffects: Transition = { type: "spring", stiffness: 1600, damping: 80, mass: 1 };

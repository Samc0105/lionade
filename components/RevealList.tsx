"use client";

// RevealList — staggered list-item reveal.
//
// Companion to RevealText for character reveals and CountUp for number
// reveals. Same motion vocabulary; each child item pops in (opacity + y +
// scale) with a configurable stagger.
//
// Existing manual sites that match this pattern (could migrate):
//   - Bluff voter chips per answer card
//   - Poker Face per-caller rows on the reveal screen
//   - Resume Coach strengths/weaknesses bullet lists
//   - Pardy Final Tally tier indicator + score block
//
// The component renders a div (default) or a configurable wrapper element
// so it can drop in for <ul>, <ol>, or grid containers. Each child gets
// wrapped in a motion.span/div with the stagger applied.

import { motion, useReducedMotion } from "framer-motion";
import { Children, type ReactNode } from "react";

interface Props {
  /** The items to reveal. Each direct child gets its own stagger slot. */
  children: ReactNode;
  /** Delay before the first child animates in (seconds). Default 0.15s. */
  delay?: number;
  /** Stagger between successive children (seconds). Default 0.06s. */
  itemDelay?: number;
  /** Per-item duration (seconds). Default 0.32s. */
  itemDuration?: number;
  /** Wrapper element. Pick "ul" or "ol" when wrapping list items so the
   *  output is semantically correct. Default "div". */
  as?: "div" | "ul" | "ol" | "section";
  /** className applied to the wrapping element. */
  className?: string;
  /** className applied to each child wrapper. Use to add display/flex if
   *  the parent layout depends on it. */
  itemClassName?: string;
}

export default function RevealList({
  children,
  delay = 0.15,
  itemDelay = 0.06,
  itemDuration = 0.32,
  as = "div",
  className,
  itemClassName,
}: Props) {
  const reduced = useReducedMotion();
  const items = Children.toArray(children);

  if (reduced) {
    // Bypass stagger entirely — render children in place inside the
    // wrapper element. Caller still gets the right semantic tag.
    const Tag = as as keyof JSX.IntrinsicElements;
    return (
      <Tag className={className}>
        {items.map((child, i) => (
          <span key={i} className={itemClassName}>
            {child}
          </span>
        ))}
      </Tag>
    );
  }

  // motion-framer doesn't accept a generic "as" via a single component,
  // so we branch the wrapper. Children are wrapped in motion.span (default)
  // because spans are layout-safe inside any of the three wrapper types.
  // Use itemClassName to add display: flex / grid where needed.
  const wrapperProps = { className };
  const childMotions = items.map((child, i) => (
    <motion.span
      key={i}
      className={`block ${itemClassName ?? ""}`}
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: itemDuration,
        delay: delay + i * itemDelay,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {child}
    </motion.span>
  ));

  if (as === "ul") return <ul {...wrapperProps}>{childMotions}</ul>;
  if (as === "ol") return <ol {...wrapperProps}>{childMotions}</ol>;
  if (as === "section") return <section {...wrapperProps}>{childMotions}</section>;
  return <div {...wrapperProps}>{childMotions}</div>;
}

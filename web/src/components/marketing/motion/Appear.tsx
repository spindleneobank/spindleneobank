import { type MotionProps, motion, useReducedMotion } from 'motion/react';
import { type ElementType, type ReactNode, useEffect, useState } from 'react';
import { SPRING } from './framer';

/** Shape of one entry of Framer's `__framer__appearAnimationsContent` JSON. */
export type AppearSpec = {
  initial?: Record<string, number | string>;
  animate?: Record<string, number | string>;
  transition?: Record<string, unknown>;
};

/**
 * Page-load / in-view appear animation using the exact values Framer emits.
 * Paste the `initial`, `animate`, `transition` from the old page's appear JSON (or the runtime component props).
 * `inView` switches from load-triggered to whileInView. SSR output and reduced-motion render the final state.
 */
export function Appear({
  as = 'div',
  spec,
  inView = false,
  once = true,
  className,
  style,
  children,
}: {
  as?: ElementType;
  spec: AppearSpec;
  inView?: boolean;
  once?: boolean;
  className?: string;
  style?: MotionProps['style'];
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(true), []);
  const Tag = (motion as unknown as Record<string, ElementType>)[as as string] ?? motion.div;
  if (reduce || !armed) {
    const T = as;
    return (
      <T className={className} style={style}>
        {children}
      </T>
    );
  }
  const transition = (spec.transition ?? SPRING) as MotionProps['transition'];
  return (
    <Tag
      className={className}
      style={style}
      initial={spec.initial}
      {...(inView
        ? { whileInView: spec.animate, viewport: { once, amount: 0.1 } }
        : { animate: spec.animate })}
      transition={transition}
    >
      {children}
    </Tag>
  );
}

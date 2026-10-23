import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

/**
 * Per-character reveal used by the old headings/typewriter text: every character is a span whose opacity goes
 * 0.001 -> 1 (linear, 10ms) with `stagger` seconds between characters (old: 0.05s). Text stays readable as plain
 * text for SSR / reduced motion / screen readers (aria-label carries the full string).
 */
export function SplitReveal({ text, stagger = 0.05, delay = 0, className }: { text: string; stagger?: number; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(true), []);
  if (reduce || !armed) return <span className={className}>{text}</span>;
  return (
    <span className={className} aria-label={text}>
      {[...text].map((ch, i) => (
        <motion.span
          // biome-ignore lint/suspicious/noArrayIndexKey: static string
          key={i}
          aria-hidden="true"
          initial={{ opacity: 0.001 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.01, delay: delay + i * stagger, ease: 'linear' }}
        >
          {ch}
        </motion.span>
      ))}
    </span>
  );
}

/** Handmade M3 base components with spring physics. */

import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import type { ReactNode } from 'react';

import { pressScale, spring, springBouncy, springSnappy } from '../../motion/springs';
import { Icon } from '../icons';
import './ui.css';

/* ---------- Button ---------- */

type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';

interface ButtonProps extends HTMLMotionProps<'button'> {
  variant?: ButtonVariant;
  big?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'filled', big = false, children, className = '', ...rest }: ButtonProps) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      className={`btn btn--${variant} ${big ? 'btn--big' : ''} ${className}`}
      whileTap={reduced ? undefined : pressScale}
      transition={springSnappy}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/* ---------- Icon button ---------- */

interface IconButtonProps extends HTMLMotionProps<'button'> {
  label: string;
  active?: boolean;
  children: ReactNode;
}

export function IconButton({ label, active = false, children, className = '', ...rest }: IconButtonProps) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      className={`iconbtn ${active ? 'iconbtn--active' : ''} ${className}`}
      aria-label={label}
      title={label}
      whileTap={reduced ? undefined : { scale: 0.88 }}
      transition={springBouncy}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/* ---------- Chip (selectable, spring overshoot on select) ---------- */

interface ChipProps {
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}

export function Chip({ selected, onToggle, disabled = false, title, children }: ChipProps) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      className={`chip ${disabled ? 'chip--disabled' : ''}`}
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={disabled ? undefined : onToggle}
      whileTap={reduced || disabled ? undefined : { scale: 0.92 }}
      animate={reduced || disabled ? undefined : { scale: selected ? [1, 1.08, 1] : 1 }}
      transition={springBouncy}
    >
      {selected && !disabled ? <><Icon name="check" size={13} />{' '}</> : null}
      {children}
    </motion.button>
  );
}

/* ---------- Segmented button with sliding thumb ---------- */

interface SegmentedProps<T extends string> {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({ options, value, onChange, className }: SegmentedProps<T>) {
  return (
    <div className={className ? `seg ${className}` : 'seg'} role="group">
      {options.map((opt) => (
        <button
          key={opt.value}
          className="seg__option"
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.value === value && (
            <motion.span
              className="seg__thumb"
              layoutId="seg-thumb"
              transition={spring}
              style={{ width: '100%', left: 0 }}
            />
          )}
          <span style={{ position: 'relative', zIndex: 1 }}>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Switch ---------- */

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <motion.span
        className="switch__thumb"
        animate={{ x: checked ? 20 : 0 }}
        transition={springSnappy}
      />
    </button>
  );
}

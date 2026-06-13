import React, { useState, useEffect, useCallback, useRef } from 'react';
import { resolveNumberInput } from './numberInputParse';

interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** The controlled numeric value (or undefined for optional fields). */
  value: number | undefined;
  /** Called with the validated number as the user types, and again (normalized) on blur. */
  onValueChange: (value: number | undefined) => void;
  /** Minimum allowed value. Clamped on every commit. */
  min?: number;
  /** Maximum allowed value. Clamped on every commit. */
  max?: number;
  /** If true, empty field commits undefined instead of clamping to min. Default: false. */
  allowEmpty?: boolean;
  /** Whether the value is an integer (uses parseInt) or float (uses parseFloat). Default: true. */
  integer?: boolean;
}

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onValueChange,
  min,
  max,
  allowEmpty = false,
  integer = true,
  className,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  ...rest
}) => {
  const [displayValue, setDisplayValue] = useState<string>(
    value !== undefined ? String(value) : ''
  );
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDisplayValue(value !== undefined ? String(value) : '');
    }
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      // keep showing exactly what the user typed; commit live so callers stay in sync
      setDisplayValue(raw);
      const result = resolveNumberInput(raw, { min, max, integer, allowEmpty, fallback: min ?? value ?? 0 }, false);
      if (result.commit) onValueChange(result.value);
    },
    [onValueChange, min, max, allowEmpty, integer, value]
  );

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    onFocusProp?.(e);
  };

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      isFocusedRef.current = false;
      const result = resolveNumberInput(displayValue, { min, max, integer, allowEmpty, fallback: min ?? value ?? 0 }, true);
      if (result.commit) onValueChange(result.value);
      if (result.display !== undefined) setDisplayValue(result.display);
      onBlurProp?.(e);
    },
    [displayValue, onValueChange, min, max, allowEmpty, integer, value, onBlurProp]
  );

  return (
    <input
      {...rest}
      type="number"
      className={className}
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      min={min}
      max={max}
    />
  );
};

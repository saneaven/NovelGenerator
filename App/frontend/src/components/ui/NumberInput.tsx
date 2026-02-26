import React, { useState, useEffect, useCallback, useRef } from 'react';

interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** The controlled numeric value (or undefined for optional fields). */
  value: number | undefined;
  /** Called with the validated number on blur, or undefined if the field is empty and allowEmpty is true. */
  onValueChange: (value: number | undefined) => void;
  /** Minimum allowed value. Clamped on blur. */
  min?: number;
  /** Maximum allowed value. Clamped on blur. */
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDisplayValue(e.target.value);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    onFocusProp?.(e);
  };

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      isFocusedRef.current = false;
      const raw = displayValue.trim();

      if (raw === '') {
        if (allowEmpty) {
          onValueChange(undefined);
          setDisplayValue('');
        } else {
          const fallback = min ?? value ?? 0;
          onValueChange(fallback);
          setDisplayValue(String(fallback));
        }
        onBlurProp?.(e);
        return;
      }

      let parsed = integer ? parseInt(raw, 10) : parseFloat(raw);

      if (Number.isNaN(parsed)) {
        const fallback = min ?? value ?? 0;
        onValueChange(fallback);
        setDisplayValue(String(fallback));
        onBlurProp?.(e);
        return;
      }

      if (min !== undefined) parsed = Math.max(min, parsed);
      if (max !== undefined) parsed = Math.min(max, parsed);
      if (integer) parsed = Math.trunc(parsed);

      onValueChange(parsed);
      setDisplayValue(String(parsed));
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

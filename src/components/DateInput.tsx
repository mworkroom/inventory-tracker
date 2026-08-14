import { useEffect, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { formatDateInput, parseDateInput } from "../lib/inventory";

interface DateInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "onChange" | "min" | "max"
  > {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}

export function DateInput({
  value,
  onChange,
  min,
  max,
  className,
  onBlur,
  onKeyDown,
  ...rest
}: DateInputProps) {
  const [text, setText] = useState(() => formatDateInput(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(formatDateInput(value));
    setInvalid(false);
  }, [value]);

  function isWithinBounds(iso: string): boolean {
    return (!min || iso >= min) && (!max || iso <= max);
  }

  function commit(nextText: string): boolean {
    if (!nextText.trim()) {
      setInvalid(false);
      onChange("");
      return true;
    }

    const normalized = parseDateInput(nextText);
    if (!normalized || !isWithinBounds(normalized)) {
      setInvalid(true);
      setText(nextText);
      onChange("");
      return false;
    }

    setInvalid(false);
    setText(formatDateInput(normalized));
    onChange(normalized);
    return true;
  }

  function handleChange(nextText: string) {
    setText(nextText);
    setInvalid(false);

    if (!nextText.trim()) {
      onChange("");
      return;
    }

    const normalized = parseDateInput(nextText);
    if (normalized && isWithinBounds(normalized)) {
      onChange(normalized);
    }
  }

  return (
    <input
      {...rest}
      type="text"
      className={className ? `date-input ${className}` : "date-input"}
      inputMode="numeric"
      autoComplete="off"
      placeholder="M/D/YYYY"
      value={text}
      aria-invalid={invalid || undefined}
      onChange={(event) => handleChange(event.currentTarget.value)}
      onBlur={(event) => {
        commit(event.currentTarget.value);
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !commit(event.currentTarget.value)) {
          event.preventDefault();
        }
        onKeyDown?.(event);
      }}
    />
  );
}

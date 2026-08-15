import type { InputHTMLAttributes } from "react";

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
  return (
    <input
      {...rest}
      type="date"
      className={className ? `date-input ${className}` : "date-input"}
      min={min}
      max={max}
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}

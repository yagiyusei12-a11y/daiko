import type { CSSProperties, InputHTMLAttributes } from "react";
import {
  formatFlexTimeOnBlur,
  sanitizeFlexTimeTyping,
  toHalfWidthTimeChars,
} from "../lib/flex-time-input";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
};

export function FlexTimeInput({
  value,
  onChange,
  className = "attend-shift-time-field",
  onFocus,
  onBlur,
  ...rest
}: Props): JSX.Element {
  const style = rest.style as CSSProperties | undefined;

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={className}
      style={style}
      value={value}
      onFocus={(e) => {
        const hw = toHalfWidthTimeChars(value);
        if (hw !== value) onChange(hw);
        onFocus?.(e);
      }}
      onChange={(e) => onChange(sanitizeFlexTimeTyping(e.target.value))}
      onBlur={(e) => {
        const formatted = formatFlexTimeOnBlur(value);
        if (formatted !== value) onChange(formatted);
        onBlur?.(e);
      }}
    />
  );
}

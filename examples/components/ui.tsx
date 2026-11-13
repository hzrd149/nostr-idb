import React, { useEffect, useRef, useState, type ReactNode } from "react";

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  wide,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  /** stretch to fill the row */
  wide?: boolean;
}) {
  return (
    <div className={`segmented ${wide ? "wide" : ""}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Numeric input with quick preset buttons */
export function NumberField({
  label,
  value,
  onChange,
  presets,
  min = 0,
  max,
  step,
  suffix,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  presets?: number[];
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="field">
      <span className="field-label">
        {label}
        {suffix && <span className="muted"> ({suffix})</span>}
      </span>
      <div className="field-control">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onChange(n);
          }}
        />
        {presets && (
          <Segmented
            value={value}
            onChange={onChange}
            options={presets.map((p) => ({ value: p, label: fmtShort(p) }))}
          />
        )}
      </div>
    </div>
  );
}

function fmtShort(n: number) {
  if (n >= 1_000_000) return n / 1_000_000 + "M";
  if (n >= 1000) return n / 1000 + "k";
  return String(n);
}

/** A labelled block with the label above its control */
export function Field({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-control">{children}</div>
    </div>
  );
}

/** Button that needs a second click to confirm */
export function ConfirmButton({
  children,
  onConfirm,
  className = "btn danger",
  disabled,
}: {
  children: ReactNode;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      disabled={disabled}
      className={`${className} ${armed ? "armed" : ""}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setArmed(false), 2500);
        }
      }}
    >
      {armed ? "confirm?" : children}
    </button>
  );
}

/** Editable list of chips */
export function ChipInput({
  values,
  onChange,
  placeholder,
  render,
  parse = (s) => s,
  suggestions,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  render?: (v: string) => ReactNode;
  parse?: (s: string) => string | null;
  suggestions?: { value: string; label: ReactNode }[];
}) {
  const [text, setText] = useState("");
  function commit(raw = text) {
    const parts = raw
      .split(/[\s,]+/)
      .map((s) => parse(s.trim()))
      .filter((s): s is string => !!s && !values.includes(s));
    if (parts.length) onChange([...values, ...parts]);
    setText("");
  }
  return (
    <div className="chipinput-wrap">
      <div className="chipinput">
        {values.map((v) => (
          <span className="chip" key={v}>
            {render ? render(v) : v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={text}
          placeholder={values.length ? "" : placeholder}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[\s,]/.test(t.trim())) {
              e.preventDefault();
              commit(t);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === " ") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !text && values.length)
              onChange(values.slice(0, -1));
          }}
          onBlur={() => text && commit()}
        />
      </div>
      {suggestions && (
        <span className="suggestions">
          {suggestions
            .filter((s) => !values.includes(s.value))
            .map((s) => (
              <button
                type="button"
                key={s.value}
                onClick={() => onChange([...values, s.value])}
              >
                {s.label}
              </button>
            ))}
        </span>
      )}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "good" | "warn" | "bad" | "accent";
}) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="progress">
      <div className="progress-bar" style={{ width: pct + "%" }} />
    </div>
  );
}

export function Section({
  title,
  children,
  right,
}: {
  title: ReactNode;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="section">
      <header className="section-head">
        <span>{title}</span>
        {right}
      </header>
      {children}
    </section>
  );
}

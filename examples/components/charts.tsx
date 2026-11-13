import React, { useMemo, useState, type ReactNode } from "react";
import { fmtMs } from "../lib/nostr.ts";

/** Horizontal bars, clickable */
export function HBars({
  items,
  max: maxOverride,
  format = (n) => n.toLocaleString(),
}: {
  items: {
    key: string;
    label: ReactNode;
    value: number;
    color?: string;
    onClick?: () => void;
  }[];
  max?: number;
  format?: (n: number) => string;
}) {
  const max = maxOverride ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="hbars">
      {items.map((item) => (
        <div
          key={item.key}
          className={`hbar ${item.onClick ? "clickable" : ""}`}
          onClick={item.onClick}
        >
          <span className="hbar-label">{item.label}</span>
          <span className="hbar-track">
            <span
              className="hbar-fill"
              style={{
                width: `${(item.value / max) * 100}%`,
                background: item.color,
              }}
            />
          </span>
          <span className="hbar-value">{format(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Vertical bars for a series of durations */
export function Bars({
  values,
  height = 60,
  color = "var(--accent)",
  format = fmtMs,
}: {
  values: number[];
  height?: number;
  color?: string | ((v: number, i: number) => string);
  format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1e-6, ...values);
  const w = 100 / Math.max(1, values.length);
  return (
    <div className="chart" style={{ height }}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        onMouseLeave={() => setHover(null)}
      >
        {values.map((v, i) => {
          const h = Math.max(0.5, (v / max) * (height - 2));
          return (
            <rect
              key={i}
              x={i * w}
              y={height - h}
              width={Math.max(w * 0.85, 0.2)}
              height={h}
              fill={typeof color === "function" ? color(v, i) : color}
              opacity={hover === null || hover === i ? 1 : 0.5}
              onMouseEnter={() => setHover(i)}
            />
          );
        })}
      </svg>
      <span className="chart-max">{format(max)}</span>
      {hover !== null && (
        <span className="chart-tip">
          #{hover + 1}: {format(values[hover])}
        </span>
      )}
    </div>
  );
}

/** Scatter plot of (x, y) points with optional series colors */
export function Scatter({
  series,
  height = 140,
  xFormat = (n) => (n / 1000).toFixed(1) + "s",
  yFormat = fmtMs,
}: {
  series: { name: string; color: string; points: [number, number][] }[];
  height?: number;
  xFormat?: (n: number) => string;
  yFormat?: (n: number) => string;
}) {
  const { maxX, maxY } = useMemo(() => {
    let maxX = 1e-6;
    let maxY = 1e-6;
    for (const s of series)
      for (const [x, y] of s.points) {
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    return { maxX, maxY };
  }, [series]);
  const W = 1000;
  return (
    <div className="chart" style={{ height }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={height * f}
            y2={height * f}
            stroke="var(--border)"
            strokeDasharray="4 6"
          />
        ))}
        {series.map((s) =>
          s.points.map(([x, y], i) => (
            <rect
              key={s.name + i}
              x={(x / maxX) * (W - 6)}
              y={height - 3 - (y / maxY) * (height - 6)}
              width={5}
              height={3}
              fill={s.color}
              opacity={0.75}
            />
          )),
        )}
      </svg>
      <span className="chart-max">{yFormat(maxY)}</span>
      <span className="chart-xmax">{xFormat(maxX)}</span>
      <span className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Histogram of values in log-spaced buckets */
export function Histogram({
  values,
  buckets = 24,
  height = 70,
  color = "var(--accent)",
  format = fmtMs,
}: {
  values: number[];
  buckets?: number;
  height?: number;
  color?: string;
  format?: (n: number) => string;
}) {
  const data = useMemo(() => {
    if (!values.length) return { counts: [], min: 0, max: 0 };
    const min = Math.max(0.01, Math.min(...values));
    const max = Math.max(min * 1.0001, ...values);
    const lmin = Math.log(min);
    const span = Math.log(max) - lmin || 1;
    const counts = new Array(buckets).fill(0);
    for (const v of values) {
      const b = Math.min(
        buckets - 1,
        Math.floor(((Math.log(Math.max(v, min)) - lmin) / span) * buckets),
      );
      counts[b]++;
    }
    return { counts, min, max };
  }, [values, buckets]);
  return (
    <div className="histogram">
      <Bars
        values={data.counts}
        height={height}
        color={color}
        format={(n) => String(Math.round(n))}
      />
      <div className="histogram-axis">
        <span>{format(data.min)}</span>
        <span>{format(data.max)}</span>
      </div>
    </div>
  );
}

import React from "react";
import { Card } from "@/components/ui/Card";

const PALETTE = [
  "hsl(var(--primary))",
  "hsl(var(--brand-red))",
  "hsl(36 88% 54%)",
  "hsl(158 58% 42%)",
  "hsl(262 62% 60%)",
  "hsl(190 72% 48%)",
];

const compact = (value: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export type ChartDatum = { label: string; value: number };

export const DonutChart: React.FC<{
  title: string;
  subtitle?: string;
  items: ChartDatum[];
  centerLabel?: string;
  valueFormatter?: (value: number) => string;
  className?: string;
}> = ({ title, subtitle, items, centerLabel = "Total", valueFormatter = compact, className }) => {
  const clean = items.filter((item) => Number.isFinite(item.value) && item.value > 0);
  const total = clean.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;

  return (
    <Card className={className}>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {total <= 0 ? (
        <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">No data recorded yet.</div>
      ) : (
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-center xl:grid-cols-1 2xl:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
          <div className="relative mx-auto h-36 w-36 max-w-full">
            <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={title}>
              <circle cx="50" cy="50" r="38" fill="none" stroke="hsl(var(--muted))" strokeWidth="14" />
              {clean.map((item, index) => {
                const share = (item.value / total) * 100;
                const dashOffset = -offset;
                offset += share;
                return (
                  <circle
                    key={`${item.label}-${index}`}
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke={PALETTE[index % PALETTE.length]}
                    strokeWidth="14"
                    pathLength="100"
                    strokeDasharray={`${share} ${100 - share}`}
                    strokeDashoffset={dashOffset}
                    transform="rotate(-90 50 50)"
                    className="transition-all duration-500"
                  />
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xl font-bold">{valueFormatter(total)}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{centerLabel}</span>
            </div>
          </div>
          <div className="min-w-0 space-y-2.5">
            {clean.slice(0, 7).map((item, index) => (
              <div key={item.label} className="flex items-center justify-between gap-3 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[index % PALETTE.length] }} />
                  <span className="truncate text-muted-foreground">{item.label}</span>
                </div>
                <span className="shrink-0 font-medium">{valueFormatter(item.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

export const TrendChart: React.FC<{
  title: string;
  subtitle?: string;
  labels: string[];
  series: Array<{ label: string; values: number[] }>;
  valueFormatter?: (value: number) => string;
  className?: string;
}> = ({ title, subtitle, labels, series, valueFormatter = compact, className }) => {
  const allValues = series.flatMap((item) => item.values).filter(Number.isFinite);
  const max = Math.max(1, ...allValues);
  const width = 600;
  const height = 210;
  const padX = 28;
  const padY = 24;
  const plotWidth = width - padX * 2;
  const plotHeight = height - padY * 2;
  const xFor = (index: number) => labels.length <= 1 ? width / 2 : padX + (index / (labels.length - 1)) * plotWidth;
  const yFor = (value: number) => padY + plotHeight - (Math.max(0, value) / max) * plotHeight;

  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          {series.map((item, index) => (
            <span key={item.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[index % PALETTE.length] }} />{item.label}
            </span>
          ))}
        </div>
      </div>
      {allValues.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">No trend data recorded yet.</div>
      ) : (
        <div className="mt-4 overflow-hidden">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full" preserveAspectRatio="none" role="img" aria-label={title}>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = padY + plotHeight - ratio * plotHeight;
              return <line key={ratio} x1={padX} x2={width - padX} y1={y} y2={y} stroke="hsl(var(--border))" strokeWidth="1" />;
            })}
            {series.map((item, seriesIndex) => {
              const points = item.values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");
              return (
                <g key={item.label}>
                  <polyline points={points} fill="none" stroke={PALETTE[seriesIndex % PALETTE.length]} strokeWidth="3" vectorEffect="non-scaling-stroke" />
                  {item.values.map((value, index) => (
                    <circle key={index} cx={xFor(index)} cy={yFor(value)} r="4" fill={PALETTE[seriesIndex % PALETTE.length]}>
                      <title>{`${item.label} · ${labels[index] ?? ""}: ${valueFormatter(value)}`}</title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </svg>
          <div className="grid text-[10px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${Math.max(1, labels.length)}, minmax(0,1fr))` }}>
            {labels.map((label) => <span key={label} className="truncate text-center">{label}</span>)}
          </div>
        </div>
      )}
    </Card>
  );
};

export const HorizontalBarChart: React.FC<{
  title: string;
  subtitle?: string;
  items: ChartDatum[];
  valueFormatter?: (value: number) => string;
  className?: string;
}> = ({ title, subtitle, items, valueFormatter = compact, className }) => {
  const clean = items.filter((item) => Number.isFinite(item.value));
  const max = Math.max(1, ...clean.map((item) => Math.max(0, item.value)));
  return (
    <Card className={className}>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="mt-5 space-y-4">
        {clean.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No data recorded yet.</p> : clean.slice(0, 10).map((item, index) => (
          <div key={item.label}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="font-medium">{valueFormatter(item.value)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, (Math.max(0, item.value) / max) * 100)}%`, background: PALETTE[index % PALETTE.length] }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

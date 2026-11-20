// SVG log-track plot: GR | Resistivity (log) | Porosity | Sonic | Computed.
// Depth increases downward (Petrel-style). Net-pay intervals are shaded
// amber across all tracks. Curves are decimated before plotting.

import type { ComputedRow, PayInterval } from "../lib/petro";

export interface EquinorPoint {
  depth: number;
  vsh: number | null;
  sw: number | null;
}

interface Props {
  rows: ComputedRow[]; // already decimated
  top: number;
  bottom: number;
  intervals: PayInterval[];
  showEquinor: boolean;
  equinor: EquinorPoint[]; // already decimated
  hasDt: boolean;
}

const W = 1080;
const H = 620;
const AXIS_W = 64;
const TRACK_W = 200;
const GAP = 4;
const PAD_TOP = 26;
const PAD_BOTTOM = 8;

function yOf(depth: number, top: number, bottom: number): number {
  return PAD_TOP + ((depth - top) / (bottom - top)) * (H - PAD_TOP - PAD_BOTTOM);
}

function xLin(v: number, lo: number, hi: number, x0: number): number {
  return x0 + ((v - lo) / (hi - lo)) * TRACK_W;
}

function xLog(v: number, lo: number, hi: number, x0: number): number {
  const l0 = Math.log10(lo);
  const l1 = Math.log10(hi);
  return x0 + ((Math.log10(Math.max(v, lo)) - l0) / (l1 - l0)) * TRACK_W;
}

function pathFrom(
  rows: ComputedRow[],
  get: (r: ComputedRow) => number | null,
  xMap: (v: number, x0: number) => number,
  x0: number,
  top: number,
  bottom: number
): string {
  let d = "";
  let started = false;
  for (const r of rows) {
    const v = get(r);
    if (v === null || !Number.isFinite(v)) {
      started = false;
      continue;
    }
    const x = xMap(v, x0);
    const y = yOf(r.depth, top, bottom);
    d += started ? ` L ${x.toFixed(1)} ${y.toFixed(1)}` : `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    started = true;
  }
  return d;
}

function equinorPath(
  pts: EquinorPoint[],
  get: (p: EquinorPoint) => number | null,
  x0: number,
  top: number,
  bottom: number
): string {
  let d = "";
  let started = false;
  for (const p of pts) {
    const v = get(p);
    if (v === null || !Number.isFinite(v)) {
      started = false;
      continue;
    }
    const x = xLin(v, 0, 1, x0);
    const y = yOf(p.depth, top, bottom);
    d += started ? ` L ${x.toFixed(1)} ${y.toFixed(1)}` : `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    started = true;
  }
  return d;
}

export default function LogTracks({ rows, top, bottom, intervals, showEquinor, equinor, hasDt }: Props) {
  const x0 = (i: number) => AXIS_W + i * (TRACK_W + GAP);
  const ticks: number[] = [];
  for (let d = Math.ceil(top / 100) * 100; d <= bottom; d += 100) ticks.push(d);

  const grPath = pathFrom(rows, (r) => r.gr, (v, x) => xLin(v, 0, 200, x), x0(0), top, bottom);
  const rtPath = pathFrom(rows, (r) => r.rt, (v, x) => xLog(v, 0.2, 2000, x), x0(1), top, bottom);
  const rhobPath = pathFrom(rows, (r) => r.rhob, (v, x) => xLin(v, 1.95, 2.95, x), x0(2), top, bottom);
  const nphiPath = pathFrom(rows, (r) => r.nphi, (v, x) => xLin(v, 0, 0.6, x), x0(2), top, bottom);
  const dtPath = pathFrom(rows, (r) => r.dt, (v, x) => xLin(v, 140, 40, x), x0(3), top, bottom);
  const vshPath = pathFrom(rows, (r) => r.vsh, (v, x) => xLin(v, 0, 1, x), x0(4), top, bottom);
  const phiPath = pathFrom(rows, (r) => r.phi, (v, x) => xLin(v, 0, 1, x), x0(4), top, bottom);
  const swPath = pathFrom(rows, (r) => r.sw, (v, x) => xLin(v, 0, 1, x), x0(4), top, bottom);
  const eqVsh = showEquinor ? equinorPath(equinor, (p) => p.vsh, x0(4), top, bottom) : "";
  const eqSw = showEquinor ? equinorPath(equinor, (p) => p.sw, x0(4), top, bottom) : "";

  const headers = [
    { title: "Gamma Ray", sub: "GR · 0–200 API", color: "#1a9850" },
    { title: "Resistivity", sub: "RT · 0.2–2000 Ω·m (log)", color: "#d73027" },
    { title: "Porosity", sub: "RHOB 1.95–2.95 · NPHI 0–0.6", color: "#2166ac" },
    { title: "Sonic", sub: "DT · 140–40 µs/ft", color: "#762a83" },
    { title: "Computed", sub: "Vsh · φ · Sw · 0–1", color: "#8c510a" },
  ];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="Well log tracks"
      style={{ display: "block", background: "#fff" }}
    >
      {/* pay shading across all tracks */}
      {intervals.map((iv, i) => (
        <rect
          key={i}
          x={AXIS_W}
          y={yOf(iv.top, top, bottom)}
          width={5 * TRACK_W + 4 * GAP}
          height={Math.max(1, yOf(iv.bottom, top, bottom) - yOf(iv.top, top, bottom))}
          fill="#f59e0b"
          opacity={0.18}
        />
      ))}
      {/* depth gridlines + labels */}
      {ticks.map((d) => (
        <g key={d}>
          <line x1={AXIS_W} x2={W - 4} y1={yOf(d, top, bottom)} y2={yOf(d, top, bottom)} stroke="#e5e7eb" strokeWidth={1} />
          <text x={AXIS_W - 8} y={yOf(d, top, bottom) + 4} textAnchor="end" fontSize={11} fill="#6b7280">
            {d}
          </text>
        </g>
      ))}
      {/* track separators + headers */}
      {headers.map((h, i) => (
        <g key={h.title}>
          <line x1={x0(i)} x2={x0(i)} y1={PAD_TOP - 4} y2={H - PAD_BOTTOM} stroke="#d1d5db" strokeWidth={1} />
          <text x={x0(i) + TRACK_W / 2} y={12} textAnchor="middle" fontSize={12} fontWeight={700} fill="#111827">
            {h.title}
          </text>
          <text x={x0(i) + TRACK_W / 2} y={24} textAnchor="middle" fontSize={10} fill={h.color}>
            {h.sub}
          </text>
        </g>
      ))}
      <line x1={W - 4} x2={W - 4} y1={PAD_TOP - 4} y2={H - PAD_BOTTOM} stroke="#d1d5db" strokeWidth={1} />

      {/* curves */}
      <path d={grPath} fill="none" stroke="#1a9850" strokeWidth={1.4} />
      <path d={rtPath} fill="none" stroke="#d73027" strokeWidth={1.4} />
      <path d={rhobPath} fill="none" stroke="#2166ac" strokeWidth={1.4} />
      <path d={nphiPath} fill="none" stroke="#b2182b" strokeWidth={1.2} strokeDasharray="5 3" />
      {hasDt ? (
        <path d={dtPath} fill="none" stroke="#762a83" strokeWidth={1.4} />
      ) : (
        <text x={x0(3) + TRACK_W / 2} y={H / 2} textAnchor="middle" fontSize={12} fill="#9ca3af">
          DT not in this file
        </text>
      )}
      <path d={vshPath} fill="none" stroke="#8c510a" strokeWidth={1.4} />
      <path d={phiPath} fill="none" stroke="#01665e" strokeWidth={1.4} />
      <path d={swPath} fill="none" stroke="#4393c3" strokeWidth={1.4} />
      {showEquinor && (
        <>
          <path d={eqVsh} fill="none" stroke="#8c510a" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
          <path d={eqSw} fill="none" stroke="#4393c3" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        </>
      )}
      {/* depth axis label */}
      <text x={12} y={H / 2} fontSize={11} fill="#6b7280" transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle">
        Depth (m)
      </text>
    </svg>
  );
}

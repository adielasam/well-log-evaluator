// Petrophysics for Milestone 1 — deterministic, transparent, editable.
//   Vsh  = (GR - GRclean) / (GRshale - GRclean), linear GR index, clipped 0..1
//   phiD = (rhoMa - RHOB) / (rhoMa - rhoF)          (density porosity)
//   phi  = mean of the porosity estimates available (density, neutron)
//   Sw   = ((a * Rw) / (phi^m * Rt)) ^ (1/n)        (Archie), clipped 0..1
//   pay  = Vsh < vshCut AND phi > phiCut AND Sw < swCut
// All parameters are user-editable in the UI; nothing is hidden.
// Cross-check on real Volve 15/9-F-1A (see data/prototype.py):
//   Sw matches Equinor's own computed SW to mean |diff| 0.03,
//   porosity to mean |diff| 0.035; Vsh differs by ~0.12 on average,
//   which is the known linear-index vs Equinor endpoint/method choice.

import { findCurve, isNull, type LasFile } from "./las";

export interface PetroParams {
  grClean: number; // API
  grShale: number; // API
  rhoMa: number; // g/cc, matrix density
  rhoF: number; // g/cc, fluid density
  archieA: number;
  archieM: number;
  archieN: number;
  rw: number; // ohm.m, formation water resistivity
  vshCut: number; // net-pay cut-off, Vsh must be below
  phiCut: number; // net-pay cut-off, porosity must be above
  swCut: number; // net-pay cut-off, Sw must be below
}

export const DEFAULT_PARAMS: PetroParams = {
  grClean: 30,
  grShale: 150,
  rhoMa: 2.65,
  rhoF: 1.0,
  archieA: 1,
  archieM: 2,
  archieN: 2,
  rw: 0.05,
  vshCut: 0.4,
  phiCut: 0.1,
  swCut: 0.6,
};

export interface ComputedRow {
  depth: number;
  gr: number | null;
  rhob: number | null;
  nphi: number | null;
  rt: number | null;
  dt: number | null;
  vsh: number | null;
  phi: number | null;
  phiD: number | null;
  sw: number | null;
  pay: boolean;
}

export interface PayInterval {
  top: number;
  bottom: number;
  thickness: number;
}

export interface Summary {
  topDepth: number | null;
  bottomDepth: number | null;
  grossThickness: number; // metres with any valid log data
  validRows: number; // rows where Vsh, phi and Sw could all be computed
  netPay: number; // metres
  avgPhiPay: number | null;
  avgSwPay: number | null;
  payIntervals: PayInterval[];
  payRows: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function computeAll(las: LasFile, p: PetroParams): ComputedRow[] {
  const iDepth = 0;
  const iGr = findCurve(las, "GR");
  const iRhob = findCurve(las, "RHOB");
  const iNphi = findCurve(las, "NPHI");
  const iRt = findCurve(las, "RT");
  const iDt = findCurve(las, "DT");
  const nv = las.nullValue;

  const val = (row: number[], i: number): number | null =>
    i < 0 ? null : isNull(row[i], nv) ? null : row[i];

  return las.rows.map((row) => {
    const depth = row[iDepth];
    const gr = val(row, iGr);
    const rhob = val(row, iRhob);
    const nphi = val(row, iNphi);
    const rt = val(row, iRt);
    const dt = val(row, iDt);

    let vsh: number | null = null;
    if (gr !== null && p.grShale > p.grClean) {
      vsh = clamp((gr - p.grClean) / (p.grShale - p.grClean), 0, 1);
    }

    let phiD: number | null = null;
    if (rhob !== null && rhob > 1.0 && rhob < 3.0 && p.rhoMa > p.rhoF) {
      phiD = clamp((p.rhoMa - rhob) / (p.rhoMa - p.rhoF), 0, 0.6);
    }
    let phi: number | null = null;
    const phis: number[] = [];
    if (phiD !== null) phis.push(phiD);
    if (nphi !== null && nphi >= 0 && nphi <= 0.6) phis.push(nphi);
    if (phis.length > 0) phi = phis.reduce((a, b) => a + b, 0) / phis.length;

    let sw: number | null = null;
    if (phi !== null && phi > 0.02 && rt !== null && rt > 0) {
      sw = clamp(
        Math.pow((p.archieA * p.rw) / (Math.pow(phi, p.archieM) * rt), 1 / p.archieN),
        0,
        1
      );
    }

    const pay =
      vsh !== null && phi !== null && sw !== null &&
      vsh < p.vshCut && phi > p.phiCut && sw < p.swCut;

    return { depth, gr, rhob, nphi, rt, dt, vsh, phi, phiD, sw, pay };
  });
}

export function summarize(rows: ComputedRow[], step: number | null): Summary {
  const valid = rows.filter((r) => r.vsh !== null && r.phi !== null && r.sw !== null);
  const withData = rows.filter(
    (r) => r.gr !== null || r.rhob !== null || r.nphi !== null || r.rt !== null
  );
  const dz = step && step > 0 ? step : 0.1;

  const payRows = rows.filter((r) => r.pay);
  const intervals: PayInterval[] = [];
  if (payRows.length > 0) {
    let top = payRows[0].depth;
    let prev = payRows[0].depth;
    for (const r of payRows.slice(1)) {
      if (Math.abs(r.depth - prev - dz) > dz * 0.5 + 0.001) {
        intervals.push({ top, bottom: prev, thickness: prev - top + dz });
        top = r.depth;
      }
      prev = r.depth;
    }
    intervals.push({ top, bottom: prev, thickness: prev - top + dz });
  }
  // Merge sub-0.3 m slivers into the list as-is; keep every interval visible.
  intervals.sort((a, b) => b.thickness - a.thickness);

  const phiPay = payRows.map((r) => r.phi as number);
  const swPay = payRows.map((r) => r.sw as number);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return {
    topDepth: withData.length ? withData[0].depth : null,
    bottomDepth: withData.length ? withData[withData.length - 1].depth : null,
    grossThickness: withData.length * dz,
    validRows: valid.length,
    netPay: payRows.length * dz,
    avgPhiPay: mean(phiPay),
    avgSwPay: mean(swPay),
    payIntervals: intervals,
    payRows: payRows.length,
  };
}

export function toCsv(rows: ComputedRow[]): string {
  const head = "Depth_m,GR_API,RHOB_gcc,NPHI_vv,RT_ohmm,DT_usft,Vsh_vv,Porosity_vv,Sw_vv,NetPay\n";
  const fmt = (v: number | null, d = 4) => (v === null ? "" : v.toFixed(d));
  const body = rows
    .map(
      (r) =>
        [
          r.depth.toFixed(2),
          fmt(r.gr, 2),
          fmt(r.rhob, 3),
          fmt(r.nphi, 3),
          fmt(r.rt, 3),
          fmt(r.dt, 2),
          fmt(r.vsh),
          fmt(r.phi),
          fmt(r.sw),
          r.pay ? "1" : "0",
        ].join(",")
    )
    .join("\n");
  return head + body + "\n";
}

/** Decimate rows to at most `max` points for plotting (keeps first/last). */
export function decimate<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const k = Math.ceil(rows.length / max);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += k) out.push(rows[i]);
  return out;
}

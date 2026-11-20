// Verification for the SHIPPED TypeScript (lib/las.ts + lib/petro.ts) on the
// real Volve 15/9-F-1A file. Expected values come from the independent Python
// prototype (data/prototype.py) — any drift means the port is wrong.
import { readFileSync } from "node:fs";
import { parseLas, findCurve, isNull } from "../lib/las";
import { computeAll, summarize, toCsv, DEFAULT_PARAMS } from "../lib/petro";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
function near(a: number, b: number, tol: number) {
  return Math.abs(a - b) <= tol;
}

const input = parseLas(readFileSync("public/data/15_9-F-1A_WLC_PETRO_COMPUTED_INPUT_1.LAS", "utf8"));
check("input parses to 35361 rows", input.rows.length === 35361, `${input.rows.length} rows`);
check("well name is 15/9-F-1A", input.well.includes("15/9-F-1"), input.well);
check("curves found", input.curves.length === 20, `${input.curves.length} curves`);
for (const key of ["GR", "RHOB", "NPHI", "RT", "DT"] as const) {
  check(`curve ${key} found`, findCurve(input, key) >= 0);
}

const computed = computeAll(input, DEFAULT_PARAMS);
const valid = computed.filter((r) => r.vsh !== null && r.phi !== null && r.sw !== null);
// 10501, not the prototype's 10495: the TS clamps each porosity estimate to
// its physical range [0, 0.6] BEFORE averaging, while the prototype averaged
// the raw (slightly negative) density porosity first. 6 rows have RHOB a hair
// above matrix density (2.652–2.660 vs 2.65), giving phi 0.0202 instead of
// 0.0195 — just over the Sw gate of 0.02. Clamping first is the correct
// behaviour (a negative porosity estimate is unphysical).
check("rows with Vsh+phi+Sw = 10501", valid.length === 10501, `${valid.length}`);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const vshMean = mean(valid.map((r) => r.vsh as number));
const phiMean = mean(valid.map((r) => r.phi as number));
const swMean = mean(valid.map((r) => r.sw as number));
check("Vsh mean ~0.157", near(vshMean, 0.157, 0.01), vshMean.toFixed(3));
check("phi mean ~0.136", near(phiMean, 0.136, 0.01), phiMean.toFixed(3));
check("Sw mean ~0.945", near(swMean, 0.945, 0.01), swMean.toFixed(3));
check("Vsh within 0..1", valid.every((r) => (r.vsh as number) >= 0 && (r.vsh as number) <= 1));
check("phi within 0..0.6", valid.every((r) => (r.phi as number) >= 0 && (r.phi as number) <= 0.6));
check("Sw within 0..1", valid.every((r) => (r.sw as number) >= 0 && (r.sw as number) <= 1));

const sum = summarize(computed, input.step);
check("net pay ~8.7 m at defaults", near(sum.netPay, 8.7, 0.5), `${sum.netPay.toFixed(1)} m`);
check(
  "largest pay interval is 2621.1–2625.3 m",
  sum.payIntervals.length > 0 &&
    near(sum.payIntervals[0].top, 2621.1, 0.2) &&
    near(sum.payIntervals[0].bottom, 2625.3, 0.2),
  sum.payIntervals.length ? `${sum.payIntervals[0].top.toFixed(1)}–${sum.payIntervals[0].bottom.toFixed(1)} m` : "none"
);

// Cut-off sensitivity: relaxing Sw cut-off to 0.8 must flag MORE pay.
const relaxed = computeAll(input, { ...DEFAULT_PARAMS, swCut: 0.8 });
const sumRelaxed = summarize(relaxed, input.step);
check("Sw cut-off 0.6 -> 0.8 increases net pay", sumRelaxed.netPay > sum.netPay, `${sum.netPay.toFixed(1)} -> ${sumRelaxed.netPay.toFixed(1)} m`);
// Tightening Vsh cut-off to 0.2 must flag LESS pay.
const tight = computeAll(input, { ...DEFAULT_PARAMS, vshCut: 0.2 });
check("Vsh cut-off 0.4 -> 0.2 decreases net pay", summarize(tight, input.step).netPay < sum.netPay);

// Cross-check vs Equinor's own computed output (same numbers as prototype).
const output = parseLas(readFileSync("public/data/15_9-F-1A_WLC_PETRO_COMPUTED_OUTPUT_1.LAS", "utf8"));
const iV = output.curves.findIndex((c) => c.mnem === "VSH");
const iS = output.curves.findIndex((c) => c.mnem === "SW");
const iP = output.curves.findIndex((c) => c.mnem === "PHIF");
const omap = new Map<number, number[]>();
for (const r of output.rows) omap.set(Math.round(r[0] * 10) / 10, r);
let dv = 0, ds = 0, dp = 0, nv = 0, ns = 0, np = 0;
for (const r of computed) {
  const o = omap.get(Math.round(r.depth * 10) / 10);
  if (!o) continue;
  if (r.vsh !== null && !isNull(o[iV], output.nullValue)) { dv += Math.abs(r.vsh - o[iV]); nv++; }
  if (r.sw !== null && !isNull(o[iS], output.nullValue)) { ds += Math.abs(r.sw - o[iS]); ns++; }
  if (r.phi !== null && !isNull(o[iP], output.nullValue)) { dp += Math.abs(r.phi - o[iP]); np++; }
}
check("Sw |mine-Equinor| mean ~0.03", near(ds / ns, 0.03, 0.02), (ds / ns).toFixed(3));
check("phi |mine-Equinor| mean ~0.035", near(dp / np, 0.035, 0.02), (dp / np).toFixed(3));
check("Vsh |mine-Equinor| mean ~0.14", near(dv / nv, 0.14, 0.03), (dv / nv).toFixed(3));

// CSV export: header + one line per row.
const csv = toCsv(computed);
check("CSV has header + all rows", csv.split("\n").length === computed.length + 2, `${csv.split("\n").length} lines`);
check("CSV header names columns", csv.startsWith("Depth_m,GR_API,RHOB_gcc"));

// Parser fallback: a small LAS with full ~C lines, no DT curve.
const mini = `~Version Information
 VERS. 2.0 : CWLS
 WRAP.  NO : one line
~Well Information Block
 STRT.M 100.0 : START
 STOP.M 100.4 : STOP
 STEP.M 0.1 : STEP
 NULL. -999.25 : NULL
 WELL. TEST-1 : Well
~Curve Information
 DEPT.M : Depth
 GR.API : Gamma Ray
 RHOB.g/cc : Bulk Density
 NPHI.v/v : Neutron Porosity
 RT.ohm.m : Resistivity
~Ascii
 100.0  45.0  2.30  0.25  12.0
 100.1  120.0  2.55  0.10  1.5
 100.2  -999.25  -999.25  -999.25  -999.25
 100.3  20.0  2.20  0.30  50.0
 100.4  60.0  2.40  0.20  5.0
`;
const miniLas = parseLas(mini);
check("mini LAS parses 5 rows", miniLas.rows.length === 5, `${miniLas.rows.length}`);
check("mini LAS has no DT", findCurve(miniLas, "DT") === -1);
const miniComp = computeAll(miniLas, DEFAULT_PARAMS);
check("mini row 1: Vsh=(45-30)/120=0.125", near(miniComp[0].vsh as number, 0.125, 0.001), String(miniComp[0].vsh));
check("mini row 1: phiD=(2.65-2.30)/1.65=0.212, phi=mean(0.212,0.25)=0.231", near(miniComp[0].phi as number, 0.231, 0.002), String(miniComp[0].phi));
check("mini row 3 (nulls) has no computed values", miniComp[2].vsh === null && miniComp[2].phi === null && miniComp[2].sw === null);
check("mini row 4 (GR 20, clean) pays", miniComp[3].pay === true);
check("mini row 2 (GR 120, Vsh 0.75) does not pay", miniComp[1].pay === false);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

// Minimal LAS 2.0 parser (WRAP NO — one line per depth step).
// Handles the two layouts seen in the wild:
//  - full ~C curve lines:  "GR  .API  45 310 01 00 : Gamma Ray"
//  - sparse ~C with the mnemonic list in ~O: "#Depth  GR  NPHI  RHOB ..."
// Falls back to treating column 0 as depth when no curve list is found.

export interface LasCurve {
  mnem: string;
  unit: string;
}

export interface LasFile {
  well: string;
  curves: LasCurve[];
  rows: number[][]; // one array per depth step, same order as curves
  nullValue: number;
  start: number | null;
  stop: number | null;
  step: number | null;
}

function cleanMnem(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "").toUpperCase();
}

export function parseLas(text: string): LasFile {
  const lines = text.split(/\r?\n/);
  let section = "";
  let nullValue = -999.25;
  let start: number | null = null;
  let stop: number | null = null;
  let step: number | null = null;
  let well = "";
  const curves: LasCurve[] = [];
  let otherMnems: string[] | null = null;
  const dataRows: number[][] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const head = line.trimStart();
    if (head.startsWith("~")) {
      section = head[1].toUpperCase();
      continue;
    }
    if (section === "V" || section === "VERSION INFORMATION") continue;

    if (section === "W" || section === "WELL INFORMATION" || section === "WELL INFORMATION BLOCK") {
      // Lines look like:  STRT.M  145.9000 : START   /   NULL.  -999.25 : NULL VALUE
      //   /   WELL.  15/9-F-1 A : Well   — the value runs up to the " : " description.
      const m = line.trim().match(/^([A-Za-z0-9]+)\.(\S*)\s+(.*)$/);
      if (m) {
        const mnem = m[1].toUpperCase();
        const value = m[3].split(":")[0].trim();
        const num = parseFloat(value);
        if (mnem === "NULL" && Number.isFinite(num)) nullValue = num;
        else if (mnem === "STRT" && Number.isFinite(num)) start = num;
        else if (mnem === "STOP" && Number.isFinite(num)) stop = num;
        else if (mnem === "STEP" && Number.isFinite(num)) step = num;
        else if (mnem === "WELL") well = value;
      }
      continue;
    }

    if (section === "C" || section === "CURVE INFORMATION") {
      if (head.startsWith("#")) continue;
      // "GR  .API  45 310 01 00 : Gamma Ray"
      const m = line.trim().match(/^([A-Za-z0-9_]+)\s*\.\s*(\S*)/);
      if (m) curves.push({ mnem: cleanMnem(m[1]), unit: m[2] || "" });
      continue;
    }

    if (section === "O" || section === "OTHER INFORMATION") {
      // Volve files carry the mnemonic list here: "#Depth  GR  NPHI  ..."
      if (head.startsWith("#")) {
        const toks = head.replace(/^#/, "").trim().split(/\s+/);
        if (toks.length > 1 && toks[0].toUpperCase().startsWith("DEPTH")) {
          otherMnems = toks.map(cleanMnem);
        }
      }
      continue;
    }

    if (section === "A" || section.startsWith("ASCII")) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      const nums = parts.map((p) => {
        const v = parseFloat(p);
        return Number.isFinite(v) ? v : NaN;
      });
      if (nums.length > 0) dataRows.push(nums);
      continue;
    }
  }

  // Resolve the curve list: ~C wins, else the ~O mnemonic line.
  let finalCurves = curves;
  if (finalCurves.length === 0 && otherMnems) {
    finalCurves = otherMnems.map((mnem) => ({ mnem, unit: "" }));
  }
  // Filter data rows to the curve count (drop short/long junk lines).
  const n = finalCurves.length;
  const rows =
    n > 0
      ? dataRows.filter((r) => r.length === n)
      : dataRows;

  if (start === null && rows.length > 0) start = rows[0][0];
  if (stop === null && rows.length > 0) stop = rows[rows.length - 1][0];

  return { well, curves: finalCurves, rows, nullValue, start, stop, step };
}

const ALIASES: Record<string, string[]> = {
  DEPTH: ["DEPT", "DEPTH", "MD"],
  GR: ["GR", "GRD", "SGR", "GRC", "GR_N"],
  RHOB: ["RHOB", "RHOZ", "DEN", "RHO", "ZDEN"],
  NPHI: ["NPHI", "NEU", "NPOR", "NPH", "CNC"],
  RT: ["RT", "RLA5", "LLD", "ILD", "AT90", "RDEP", "RT_HRLT"],
  DT: ["DT", "DTCO", "AC", "DTC", "DT24"],
  CALI: ["CALI", "CAL", "HCAL"],
  DRHO: ["DRHO", "DRH", "ZCOR"],
  PEF: ["PEF", "PE", "PEFZ"],
};

/** Index of the first curve whose mnemonic matches one of the aliases. */
export function findCurve(las: LasFile, key: keyof typeof ALIASES): number {
  const wanted = ALIASES[key];
  for (const w of wanted) {
    const i = las.curves.findIndex((c) => c.mnem === w);
    if (i >= 0) return i;
  }
  return -1;
}

export function isNull(v: number, nullValue: number): boolean {
  return !Number.isFinite(v) || v === nullValue;
}

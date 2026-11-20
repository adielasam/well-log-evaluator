"""Prototype the Milestone 1 petrophysics on real Volve 15/9-F-1A data.

Parses the INPUT LAS (GR, NPHI, RHOB, DT, RT) and the OUTPUT LAS
(Equinor's own VSH, SW, PHIF) and checks:
  - Vsh = (GR - GRclean) / (GRshale - GRclean), clipped 0..1
  - phiD = (rho_ma - RHOB) / (rho_ma - rho_f);  phi = mean(phiD, NPHI) where both exist
  - Sw  = ((a * Rw) / (phi^m * Rt)) ** (1/n)   (Archie), clipped 0..1
  - net pay: Vsh < 0.40, phi > 0.10, Sw < 0.60
Cross-checks computed Vsh/Sw/phi against Equinor's VSH/SW/PHIF at the
same depths (output file covers 3358.0 m down).
"""
import math
import statistics

NULL = -999.25
GR_CLEAN, GR_SHALE = 30.0, 150.0
RHO_MA, RHO_F = 2.65, 1.0
A, M, N, RW = 1.0, 2.0, 2.0, 0.05
VSH_MAX, PHI_MIN, SW_MAX = 0.40, 0.10, 0.60

INPUT = "15_9-F-1A_WLC_PETRO_COMPUTED_INPUT_1.LAS"
OUTPUT = "15_9-F-1A_WLC_PETRO_COMPUTED_OUTPUT_1.LAS"


def parse_las(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    # curve order is in the ~O section: '#Depth  ABDCQF01 ...'
    curves = None
    start = None
    for i, ln in enumerate(lines):
        if ln.startswith("#Depth"):
            curves = ln.lstrip("#").split()
        if ln.strip() == "~A":
            start = i + 1
            break
    rows = []
    for ln in lines[start:]:
        parts = ln.split()
        if len(parts) != len(curves):
            continue
        rows.append([float(x) for x in parts])
    return curves, rows


def valid(v):
    return v is not None and v != NULL and not math.isnan(v)


curves, rows = parse_las(INPUT)
idx = {c: i for i, c in enumerate(curves)}
print("INPUT curves:", curves)
print("INPUT rows:", len(rows), "depth", rows[0][0], "->", rows[-1][0])

# --- per-row computation over the whole file ---
n_valid = {"GR": 0, "RHOB": 0, "NPHI": 0, "RT": 0, "DT": 0}
computed = []  # (depth, vsh, phi, sw, pay)
gr_all, rt_all = [], []
for r in rows:
    d = r[idx["Depth"]]
    gr, rhob, nphi, rt, dt = (r[idx[c]] for c in ("GR", "RHOB", "NPHI", "RT", "DT"))
    for k, v in (("GR", gr), ("RHOB", rhob), ("NPHI", nphi), ("RT", rt), ("DT", dt)):
        if valid(v):
            n_valid[k] += 1
    if valid(gr):
        gr_all.append(gr)
    if valid(rt):
        rt_all.append(rt)
    vsh = phi = sw = None
    if valid(gr):
        vsh = min(1.0, max(0.0, (gr - GR_CLEAN) / (GR_SHALE - GR_CLEAN)))
    phis = []
    if valid(rhob) and 1.0 < rhob < 3.0:
        phis.append((RHO_MA - rhob) / (RHO_MA - RHO_F))
    if valid(nphi) and 0.0 <= nphi <= 0.6:
        phis.append(nphi)
    if phis:
        phi = min(0.6, max(0.0, sum(phis) / len(phis)))
    if phi is not None and phi > 0.02 and valid(rt) and rt > 0:
        sw = min(1.0, max(0.0, ((A * RW) / (phi ** M * rt)) ** (1.0 / N)))
    pay = vsh is not None and phi is not None and sw is not None \
        and vsh < VSH_MAX and phi > PHI_MIN and sw < SW_MAX
    computed.append((d, vsh, phi, sw, pay))

print("valid counts:", n_valid)
print("GR range: %.1f - %.1f API (median %.1f)" % (min(gr_all), max(gr_all), statistics.median(gr_all)))
print("RT range: %.2f - %.1f ohm.m (median %.2f)" % (min(rt_all), max(rt_all), statistics.median(rt_all)))

# depth window where all four curves exist
full = [c for c in computed if c[1] is not None and c[2] is not None and c[3] is not None]
print("rows with Vsh+phi+Sw:", len(full), "depth %.1f -> %.1f" % (full[0][0], full[-1][0]))
vshs = [c[1] for c in full]
phis = [c[2] for c in full]
sws = [c[3] for c in full]
print("Vsh  range %.3f - %.3f (mean %.3f)" % (min(vshs), max(vshs), statistics.mean(vshs)))
print("phi  range %.3f - %.3f (mean %.3f)" % (min(phis), max(phis), statistics.mean(phis)))
print("Sw   range %.3f - %.3f (mean %.3f)" % (min(sws), max(sws), statistics.mean(sws)))
pay = [c for c in full if c[4]]
print("net-pay rows:", len(pay), "-> net thickness %.1f m (0.1 m step)" % (len(pay) * 0.1))
if pay:
    print("pay depth %.1f -> %.1f" % (pay[0][0], pay[-1][0]))
    # contiguous pay intervals
    intervals, s = [], pay[0][0]
    prev = pay[0][0]
    for c in pay[1:]:
        if abs(c[0] - prev - 0.1) > 0.01:
            intervals.append((s, prev))
            s = c[0]
        prev = c[0]
    intervals.append((s, prev))
    big = sorted(intervals, key=lambda t: t[1] - t[0], reverse=True)[:8]
    print("largest pay intervals (m):", [(round(a, 1), round(b, 1), round(b - a, 1)) for a, b in big])

# --- cross-check vs Equinor's own computed output ---
ocurves, orows = parse_las(OUTPUT)
oidx = {c: i for i, c in enumerate(ocurves)}
print("\nOUTPUT curves:", ocurves)
print("OUTPUT rows:", len(orows), "depth", orows[0][0], "->", orows[-1][0])
omap = {}
for r in orows:
    omap[round(r[oidx["Depth"]], 1)] = r
dv, dp, ds, n = [], [], [], 0
for d, vsh, phi, sw, pay in computed:
    o = omap.get(round(d, 1))
    if not o:
        continue
    ov, os_, op = o[oidx["VSH"]], o[oidx["SW"]], o[oidx["PHIF"]]
    if vsh is not None and valid(ov):
        dv.append(abs(vsh - ov))
    if sw is not None and valid(os_):
        ds.append(abs(sw - os_))
    if phi is not None and valid(op):
        dp.append(abs(phi - op))
    n += 1
print("overlap rows checked:", n)
if dv:
    print("Vsh  |mine - Equinor| mean %.3f  median %.3f  (n=%d)" % (statistics.mean(dv), statistics.median(dv), len(dv)))
if ds:
    print("Sw   |mine - Equinor| mean %.3f  median %.3f  (n=%d)" % (statistics.mean(ds), statistics.median(ds), len(ds)))
if dp:
    print("phi  |mine - Equinor| mean %.3f  median %.3f  (n=%d)" % (statistics.mean(dp), statistics.median(dp), len(dp)))

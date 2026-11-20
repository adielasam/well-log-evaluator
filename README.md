# Well-Log Evaluator — mini-Petrel (Milestone 1)

A web app for well-log and formation evaluation: upload a LAS file (or load
the built-in well) and it renders log tracks, computes shale volume,
porosity and water saturation per depth, flags net pay, and exports the
computed table as CSV. Everything runs in the browser — **no database, no
server-side storage, nothing to pause or pay for**. Deploy it on Vercel's
free tier as a static Next.js site.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve the production build
npm test         # npx tsx test/verify.ts — 32 checks on the real Volve data
```

Deploy: push to a GitHub repo and import it in Vercel (Framework: Next.js,
all defaults). No environment variables, no database to provision.

## What it does (Milestone 1)

1. **Load a well** — the built-in Volve 15/9-F-1A well, or upload any LAS 2.0
   file (WRAP NO). The parser handles full `~C` curve lists and the sparse
   Volve layout (mnemonics in `~O`), and recognises common aliases
   (GR/RHOB/NPHI/RT/DT, e.g. RLA5, LLD, DTCO).
2. **Log tracks** — gamma ray, resistivity (log scale), neutron/density
   porosity, sonic, and a computed track (Vsh, φ, Sw). Depth increases
   downward; net-pay intervals are shaded amber across all tracks.
3. **Petrophysics, per depth** — all parameters editable in the UI:
   - Vsh = (GR − GR_clean) / (GR_shale − GR_clean), linear GR index, 0–1
   - φ_D = (ρ_ma − RHOB) / (ρ_ma − ρ_f); φ = mean of the density and neutron
     estimates available (each clamped to its physical range first)
   - Sw = ((a·Rw) / (φ^m · Rt))^(1/n) — Archie
   - Net pay: Vsh < cut-off AND φ > cut-off AND Sw < cut-off
4. **Summary** — gross thickness, net pay, average porosity and Sw in pay,
   pay-interval list.
5. **Export** — the full computed table as CSV.
6. **Compare** — optional overlay of Equinor's own computed VSH / SW for
   15/9-F-1A (dashed), from the same well's computed-output LAS.

Defaults: GR clean 30 API, GR shale 150 API, matrix density 2.65 g/cc,
fluid density 1.0 g/cc, Archie a=1, m=2, n=2, Rw=0.05 Ω·m,
cut-offs Vsh < 0.40, φ > 0.10, Sw < 0.60.

Deliberately **not** in Milestone 1: ML permeability prediction (Milestone 2),
multi-well comparison, seismic.

## Data — real Volve, not synthetic

Built-in well: **15/9-F-1A, Volve field, Norwegian North Sea**,
`public/data/15_9-F-1A_WLC_PETRO_COMPUTED_INPUT_1.LAS`
(11 MB, 35,361 rows, 145.9–3681.9 m at 0.1 m step; curves GR, NPHI, RHOB,
DT, RT, CALI, DRHO, PEF and others; NULL −999.25).
Source: Equinor Volve open dataset, mirrored in
[`andymcdgeo/spwla_volve`](https://github.com/andymcdgeo/spwla_volve)
(15_9-F-1A folder). The comparison file
`15_9-F-1A_WLC_PETRO_COMPUTED_OUTPUT_1.LAS` carries Equinor's own
computed VSH, SW, PHIF and KLOGH for the same well.

**Licence (honoured in the app footer):** Equinor Open Data Licence
(modified CC-BY style) — attribution required, not for resale. This is a
demo / portfolio tool, not a commercial product.

**How the file was obtained (2026-11-19):** Equinor's original Azure
"Data Village" direct downloads are retired; the dataset is now served
via Databricks Marketplace (Databricks account required, ~100 GB bundle).
The single-well LAS files used here come from the public SPWLA mirror
above — no account needed. To swap in a different well, drop its `.LAS`
into `public/data/`, or use the Upload button at runtime (no rebuild
needed). To fetch the full dataset yourself, start at
https://www.equinor.com/energy/data-sharing and follow the Databricks
Marketplace link.

## Verification (all done 2026-11-19)

- `npm run build` passes clean (Next.js 16, TypeScript).
- `npm test` — 32 checks, all pass, including:
  - the shipped TypeScript parser + petrophysics on the real file:
    35,361 rows; Vsh mean 0.157, φ mean 0.136, Sw mean 0.945;
    net pay **8.7 m** at defaults, largest interval **2621.1–2625.3 m**;
  - cut-off sensitivity: Sw cut-off 0.6 → 0.8 raises net pay 8.7 → 21.1 m;
    Vsh cut-off 0.4 → 0.2 lowers it — the UI controls genuinely re-flag pay;
  - cross-check against Equinor's own computed values at the same depths:
    Sw mean |difference| **0.030**, porosity **0.036**, Vsh **0.140**
    (Vsh differs mainly by endpoint/method — the linear GR index vs
    Equinor's own VSH; adjust GR clean/shale in the UI to test it);
  - hand-checked rows (Vsh, φ_D, pay logic) on a small synthetic LAS,
    including missing-curve handling (no DT → sonic track reports
    "not in file", porosity falls back to the curves present).
- Production server smoke test: `/` returns 200 with the app shell, and
  both LAS assets serve (11,319,531 and 469,435 bytes).
- The calculations were first prototyped independently in Python
  (`public/data/prototype.py`) and the TypeScript port reproduces them.

Note on the well: with the default cut-offs this well flags only 8.7 m of
net pay. That is what the real data says — Equinor's own SW in its sand
intervals averages 0.93, i.e. this well is largely water-bearing, and its
main sand sits at 3435–3650 m (our largest flagged interval, 3440.7–3442.0 m,
lies inside it). Rw is the most sensitive parameter: Rw 0.02 → 47.0 m,
0.05 → 8.7 m, 0.10 → 4.3 m. It is editable in the UI for exactly this reason.

## Stack — zero-cost, migratable (the owner's rule)

Next.js 16 (App Router, TypeScript) + React only. No database, no backend,
no Supabase, no chart library (tracks are hand-drawn SVG). The LAS is a
static asset; all computation happens in the browser, so there is nothing
server-side to pause after 7 days idle and nothing to migrate away from —
the whole app is a static site plus two data files.

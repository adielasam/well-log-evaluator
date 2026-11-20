"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LogTracks, { type EquinorPoint } from "../components/LogTracks";
import { parseLas, findCurve, isNull, type LasFile } from "../lib/las";
import {
  computeAll,
  summarize,
  toCsv,
  decimate,
  DEFAULT_PARAMS,
  type PetroParams,
} from "../lib/petro";

const BUILTIN_LAS = "/data/15_9-F-1A_WLC_PETRO_COMPUTED_INPUT_1.LAS";
const BUILTIN_NAME = "15/9-F-1A — Volve field, Norwegian North Sea (real Equinor open data)";
const EQUINOR_LAS = "/data/15_9-F-1A_WLC_PETRO_COMPUTED_OUTPUT_1.LAS";

const fmt = (v: number | null, d = 3) => (v === null ? "—" : v.toFixed(d));

export default function Home() {
  const [las, setLas] = useState<LasFile | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [params, setParams] = useState<PetroParams>(DEFAULT_PARAMS);
  const [showEquinor, setShowEquinor] = useState<boolean>(false);
  const [equinor, setEquinor] = useState<EquinorPoint[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadText = useCallback((text: string, name: string) => {
    try {
      const parsed = parseLas(text);
      if (parsed.rows.length === 0 || parsed.curves.length < 2) {
        throw new Error("No data rows found — is this a LAS 2.0 file?");
      }
      setLas(parsed);
      setFileName(name);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse this LAS file.");
    }
  }, []);

  const loadBuiltin = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(BUILTIN_LAS);
      if (!res.ok) throw new Error(`Built-in well file failed to load (HTTP ${res.status}).`);
      loadText(await res.text(), BUILTIN_NAME);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Built-in well failed to load.");
    } finally {
      setLoading(false);
    }
  }, [loadText]);

  useEffect(() => {
    loadBuiltin();
  }, [loadBuiltin]);

  const onUpload = useCallback(
    (f: File | undefined) => {
      if (!f) return;
      setLoading(true);
      const reader = new FileReader();
      reader.onload = () => {
        loadText(String(reader.result ?? ""), f.name);
        setLoading(false);
      };
      reader.onerror = () => {
        setError("Could not read that file.");
        setLoading(false);
      };
      reader.readAsText(f);
    },
    [loadText]
  );

  const onToggleEquinor = useCallback(async (on: boolean) => {
    setShowEquinor(on);
    if (on && equinor.length === 0) {
      try {
        const res = await fetch(EQUINOR_LAS);
        const parsed = parseLas(await res.text());
        const iV = parsed.curves.findIndex((c) => c.mnem === "VSH");
        const iS = parsed.curves.findIndex((c) => c.mnem === "SW");
        const pts: EquinorPoint[] = parsed.rows.map((r) => ({
          depth: r[0],
          vsh: iV >= 0 && !isNull(r[iV], parsed.nullValue) ? r[iV] : null,
          sw: iS >= 0 && !isNull(r[iS], parsed.nullValue) ? r[iS] : null,
        }));
        setEquinor(pts);
      } catch {
        setError("Equinor comparison file failed to load.");
        setShowEquinor(false);
      }
    }
  }, [equinor.length]);

  const computed = useMemo(() => (las ? computeAll(las, params) : []), [las, params]);
  const summary = useMemo(
    () => (las ? summarize(computed, las.step) : null),
    [las, computed]
  );
  const plotRows = useMemo(() => decimate(computed, 1400), [computed]);
  const equinorPlot = useMemo(() => decimate(equinor, 1400), [equinor]);
  const hasDt = las ? findCurve(las, "DT") >= 0 : false;
  const hasRt = las ? findCurve(las, "RT") >= 0 : false;
  const top = summary?.topDepth ?? null;
  const bottom = summary?.bottomDepth ?? null;

  const tableSample = useMemo(() => {
    const valid = computed.filter((r) => r.vsh !== null || r.phi !== null || r.sw !== null);
    return decimate(valid, 120);
  }, [computed]);

  const setParam = (key: keyof PetroParams, value: number) =>
    setParams((p) => ({ ...p, [key]: Number.isFinite(value) ? value : p[key] }));

  const exportCsv = () => {
    const blob = new Blob([toCsv(computed)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "well-log-evaluation.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const paramField = (
    key: keyof PetroParams,
    label: string,
    unit: string,
    step = 0.01
  ) => (
    <label className="param">
      <span>
        {label} <em>{unit}</em>
      </span>
      <input
        type="number"
        step={step}
        value={params[key]}
        onChange={(e) => setParam(key, parseFloat(e.target.value))}
      />
    </label>
  );

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>Well-Log Evaluator</h1>
          <p>Mini-Petrel — well-log &amp; formation evaluation, computed in your browser. No database, no upload to a server.</p>
        </div>
        <div className="topbar-right">
          <span className="badge">Milestone 1</span>
          <span className="badge">Volve 15/9-F-1A</span>
        </div>
      </header>

      <section className="card controls">
        <div className="control-row">
          <button onClick={loadBuiltin} disabled={loading}>
            {loading ? "Loading…" : "Load built-in Volve well"}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={loading}>
            Upload a LAS file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".las,.LAS"
            hidden
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
          <button onClick={exportCsv} disabled={!las || computed.length === 0}>
            Export computed table (CSV)
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={showEquinor}
              onChange={(e) => onToggleEquinor(e.target.checked)}
            />
            Compare with Equinor&rsquo;s own VSH / SW (dashed)
          </label>
        </div>
        <p className="well-line">
          <strong>Well:</strong> {fileName || "—"}
          {las && (
            <>
              {" "}· {las.rows.length.toLocaleString()} depth steps
              {las.start !== null && las.stop !== null && (
                <> · {las.start.toFixed(1)}–{las.stop.toFixed(1)} m</>
              )}
              {las.step !== null && <> · step {las.step} m</>}
            </>
          )}
        </p>
        {error && <p className="error">{error}</p>}
        {!hasRt && las && (
          <p className="warn">This file has no resistivity curve, so water saturation (Sw) cannot be computed.</p>
        )}
      </section>

      {summary && (
        <section className="summary">
          <div className="stat">
            <span>Gross thickness</span>
            <strong>{summary.grossThickness.toFixed(1)} m</strong>
            <small>logged interval with data</small>
          </div>
          <div className="stat highlight">
            <span>Net pay</span>
            <strong>{summary.netPay.toFixed(1)} m</strong>
            <small>{summary.payRows.toLocaleString()} samples flagged</small>
          </div>
          <div className="stat">
            <span>Avg porosity in pay</span>
            <strong>{fmt(summary.avgPhiPay)}</strong>
            <small>volume fraction</small>
          </div>
          <div className="stat">
            <span>Avg Sw in pay</span>
            <strong>{fmt(summary.avgSwPay)}</strong>
            <small>Archie water saturation</small>
          </div>
          <div className="stat">
            <span>Pay intervals</span>
            <strong>{summary.payIntervals.length}</strong>
            <small>
              {summary.payIntervals.length > 0
                ? `largest ${summary.payIntervals[0].top.toFixed(1)}–${summary.payIntervals[0].bottom.toFixed(1)} m (${summary.payIntervals[0].thickness.toFixed(1)} m)`
                : "none flagged at these cut-offs"}
            </small>
          </div>
        </section>
      )}

      <div className="layout">
        <section className="card tracks">
          <h2>Log tracks {top !== null && bottom !== null && <span>· {top.toFixed(0)}–{bottom.toFixed(0)} m</span>}</h2>
          {top !== null && bottom !== null && computed.length > 0 ? (
            <LogTracks
              rows={plotRows}
              top={top}
              bottom={bottom}
              intervals={summary?.payIntervals ?? []}
              showEquinor={showEquinor}
              equinor={equinorPlot}
              hasDt={hasDt}
            />
          ) : (
            <p className="empty">{loading ? "Loading well…" : "Load a well to see the tracks."}</p>
          )}
          <p className="legend">
            <span><i style={{ background: "#1a9850" }} /> GR</span>
            <span><i style={{ background: "#d73027" }} /> RT</span>
            <span><i style={{ background: "#2166ac" }} /> RHOB</span>
            <span><i style={{ background: "#b2182b" }} /> NPHI (dashed)</span>
            <span><i style={{ background: "#762a83" }} /> DT</span>
            <span><i style={{ background: "#8c510a" }} /> Vsh</span>
            <span><i style={{ background: "#01665e" }} /> φ</span>
            <span><i style={{ background: "#4393c3" }} /> Sw</span>
            <span><i style={{ background: "#f59e0b" }} /> net pay</span>
          </p>
        </section>

        <aside className="card params">
          <h2>Parameters — all editable</h2>
          <div className="param-group">
            <h3>Net-pay cut-offs</h3>
            {paramField("vshCut", "Vsh must be below", "v/v", 0.05)}
            {paramField("phiCut", "Porosity must be above", "v/v", 0.01)}
            {paramField("swCut", "Sw must be below", "v/v", 0.05)}
          </div>
          <div className="param-group">
            <h3>Shale volume (linear GR index)</h3>
            {paramField("grClean", "GR clean", "API", 1)}
            {paramField("grShale", "GR shale", "API", 1)}
          </div>
          <div className="param-group">
            <h3>Porosity</h3>
            {paramField("rhoMa", "Matrix density", "g/cc", 0.01)}
            {paramField("rhoF", "Fluid density", "g/cc", 0.01)}
          </div>
          <div className="param-group">
            <h3>Archie water saturation</h3>
            {paramField("archieA", "a (tortuosity)", "—", 0.1)}
            {paramField("archieM", "m (cementation)", "—", 0.1)}
            {paramField("archieN", "n (saturation)", "—", 0.1)}
            {paramField("rw", "Rw (formation water)", "Ω·m", 0.01)}
          </div>
          <button className="secondary" onClick={() => setParams(DEFAULT_PARAMS)}>
            Reset defaults
          </button>
          <p className="formula">
            Vsh = (GR − GR<sub>clean</sub>) / (GR<sub>shale</sub> − GR<sub>clean</sub>)
            <br />φ<sub>D</sub> = (ρ<sub>ma</sub> − RHOB) / (ρ<sub>ma</sub> − ρ<sub>f</sub>),
            φ = mean(φ<sub>D</sub>, NPHI)
            <br />Sw = ((a·Rw) / (φ<sup>m</sup>·Rt))<sup>1/n</sup>
          </p>
        </aside>
      </div>

      {summary && summary.payIntervals.length > 0 && (
        <section className="card">
          <h2>Pay intervals</h2>
          <table>
            <thead>
              <tr><th>#</th><th>Top (m)</th><th>Bottom (m)</th><th>Thickness (m)</th></tr>
            </thead>
            <tbody>
              {summary.payIntervals.map((iv, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{iv.top.toFixed(1)}</td>
                  <td>{iv.bottom.toFixed(1)}</td>
                  <td>{iv.thickness.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tableSample.length > 0 && (
        <section className="card">
          <h2>Computed table <span>(sampled — CSV export has every row)</span></h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Depth (m)</th><th>GR (API)</th><th>RHOB (g/cc)</th><th>NPHI (v/v)</th>
                  <th>RT (Ω·m)</th><th>DT (µs/ft)</th><th>Vsh</th><th>φ</th><th>Sw</th><th>Pay</th>
                </tr>
              </thead>
              <tbody>
                {tableSample.map((r, i) => (
                  <tr key={i} className={r.pay ? "pay-row" : ""}>
                    <td>{r.depth.toFixed(1)}</td>
                    <td>{fmt(r.gr, 1)}</td>
                    <td>{fmt(r.rhob)}</td>
                    <td>{fmt(r.nphi)}</td>
                    <td>{fmt(r.rt, 2)}</td>
                    <td>{fmt(r.dt, 1)}</td>
                    <td>{fmt(r.vsh)}</td>
                    <td>{fmt(r.phi)}</td>
                    <td>{fmt(r.sw)}</td>
                    <td>{r.pay ? "✓" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer>
        <p>
          Data: Equinor Volve field open dataset, well 15/9-F-1A (wireline LAS,
          WLC_PETRO_COMPUTED_INPUT_1.LAS), via the Equinor Open Data Licence
          (modified CC-BY style) — attribution required, not for resale.
          Comparison curves from the same well&rsquo;s WLC_PETRO_COMPUTED_OUTPUT_1.LAS.
          Demo / portfolio tool, not a commercial product.{" "}
          <a href="https://www.equinor.com/energy/data-sharing" target="_blank" rel="noreferrer">
            equinor.com/energy/data-sharing
          </a>
        </p>
        <p>
          Method: linear GR-index Vsh, density / neutron-density porosity, Archie Sw.
          Cross-check on this well: Sw matches Equinor&rsquo;s own computed SW to mean
          |difference| 0.03; porosity to 0.035. Vsh differs by ~0.12 on average —
          the known linear-index vs Equinor endpoint/method choice; adjust GR clean/shale above to test it.
        </p>
      </footer>
    </main>
  );
}

'use client';

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { apiCsv, apiJson } from "@/lib/api";

type Health = { ok: boolean; model: string };
type Whoami = { user_id: string };
type PredictOut = { outputs: number[] };

type MetricRow = {
  created_at: string;
  latency_ms?: number | null;
  cost_usd?: number | null;
};

const DEFAULT_FEATURES = ["f1", "f2", "f3"];

export default function Page() {
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const [health, setHealth] = useState<Health | null>(null);
  const [who, setWho] = useState<Whoami | null>(null);

  const [featureCols, setFeatureCols] = useState<string[]>(DEFAULT_FEATURES);
  const [rows, setRows] = useState<number>(1);
  const [inputs, setInputs] = useState<number[][]>([[0, 0, 0]]);
  const [outputs, setOutputs] = useState<number[] | null>(null);
  const [csvResultUrl, setCsvResultUrl] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<MetricRow[]>([]);

  useEffect(() => {
    setInputs(Array.from({ length: rows }, () => Array(featureCols.length).fill(0)));
  }, [rows, featureCols.length]);

  // Auth session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  // Health / Whoami
  const checkHealth = async () => setHealth(await apiJson<Health>("/health"));
  const checkWhoami = async () => {
    if (!token) return;
    setWho(await apiJson<Whoami>("/whoami", token));
  };

  // Predict
  const doPredict = async () => {
    if (!token) return alert("Login first.");
    const body = { inputs };
    const res = await apiJson<PredictOut>("/predict", token, "POST", body);
    setOutputs(res.outputs);
  };

  // CSV Predict
  const onCsvFile = async (file: File) => {
    if (!token) return alert("Login first.");
    const blob = await apiCsv("/predict_csv", file, token);
    const url = URL.createObjectURL(blob);
    setCsvResultUrl(url);
  };

  // Metrics (anonymous read; RLS may still filter by project)
  useEffect(() => {
    const load = async () => {
      const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;
      let q = supabase
        .from("usage_logs")
        .select("created_at, latency_ms, cost_usd")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (!error && data) setMetrics(data as MetricRow[]);
    };
    void load();
  }, []);

  const { dailyReqs, dailyP95, dailyCost, p95All, total, totalCost } = useMemo(() => {
    if (!metrics?.length)
      return { dailyReqs: [] as { day: string; reqs: number }[], dailyP95: [] as { day: string; p95: number }[], dailyCost: [] as { day: string; cost: number }[], p95All: 0, total: 0, totalCost: 0 };

    const byDay = new Map<string, { lat: number[]; cost: number[] }>();
    for (const r of metrics) {
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      const lat = Number(r.latency_ms ?? 0);
      const cost = Number(r.cost_usd ?? 0);
      if (!byDay.has(day)) byDay.set(day, { lat: [], cost: [] });
      byDay.get(day)!.lat.push(lat);
      byDay.get(day)!.cost.push(cost);
    }
    const days = Array.from(byDay.keys()).sort();
    const p = (arr: number[], q: number) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const idx = Math.floor((s.length - 1) * q);
      return s[idx];
    };
    const dailyReqs = days.map((d) => ({ day: d, reqs: byDay.get(d)!.lat.length }));
    const dailyP95 = days.map((d) => ({ day: d, p95: p(byDay.get(d)!.lat, 0.95) }));
    const dailyCost = days.map((d) => ({ day: d, cost: byDay.get(d)!.cost.reduce((a, b) => a + b, 0) }));
    const p95All = p(metrics.map((r) => Number(r.latency_ms ?? 0)), 0.95);
    const totalCost = metrics.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    return { dailyReqs, dailyP95, dailyCost, p95All, total: metrics.length, totalCost };
  }, [metrics]);

  return (
    <main className="space-y-8">
      {/* Auth */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Authentication</h2>
          {token ? <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button> : null}
        </div>
        {!token ? (
          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            <div>
              <div className="label">Email</div>
              <input className="input w-full" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <div className="label">Password</div>
              <input className="input w-full" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <button
                className="btn"
                onClick={async () => {
                  const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
                  if (error) alert(error.message);
                }}
              >
                Sign in
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex gap-3">
            <button className="btn" onClick={checkHealth}>Check Health</button>
            <button className="btn" onClick={checkWhoami}>Who am I</button>
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <pre className="card p-3 text-sm">{health ? JSON.stringify(health, null, 2) : "—"}</pre>
          <pre className="card p-3 text-sm">{who ? JSON.stringify(who, null, 2) : "—"}</pre>
        </div>
      </section>

      {/* Single/small batch */}
      <section className="card p-5 space-y-4">
        <h2 className="text-lg font-semibold">Single / Small-batch Predictions</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="label">Rows</div>
            <input
              type="number"
              min={1}
              max={50}
              className="input w-28"
              value={rows}
              onChange={(e) => setRows(parseInt(e.target.value || "1", 10))}
            />
          </div>
          <div className="flex-1 min-w-[260px]">
            <div className="label">Feature columns (comma-separated)</div>
            <input
              className="input w-full"
              value={featureCols.join(",")}
              onChange={(e) => setFeatureCols(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            />
          </div>
        </div>
        <div className="space-y-2">
          {inputs.map((row, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              {row.map((v, j) => (
                <input
                  key={j}
                  className="input w-28"
                  type="number"
                  value={v}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value || "0");
                    setInputs((prev) => prev.map((r, ri) => (ri === i ? r.map((x, rj) => (rj === j ? val : x)) : r)));
                  }}
                  placeholder={featureCols[j] ?? `x${j}`}
                />
              ))}
            </div>
          ))}
        </div>
        <button className="btn" disabled={!token} onClick={doPredict}>
          Predict
        </button>
        {outputs && <pre className="card p-3 text-sm">{JSON.stringify({ outputs }, null, 2)}</pre>}
      </section>

      {/* CSV batch */}
      <section className="card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Batch CSV</h2>
        <input type="file" accept=".csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onCsvFile(f); }} />
        {csvResultUrl && (
          <a className="btn mt-3" download="predictions.csv" href={csvResultUrl}>
            Download predictions.csv
          </a>
        )}
      </section>

      {/* Simple KPIs (derived locally from usage_logs) */}
      <section className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <KPI label="Total requests" value={String(total)} />
          <KPI label="p95 latency (ms)" value={String(p95All | 0)} />
          <KPI label="Cost ($)" value={totalCost.toFixed(4)} />
        </div>
      </section>
    </main>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4 min-w-[180px]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

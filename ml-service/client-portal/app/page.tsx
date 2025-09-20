"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
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

// Read public env (Vercel UI -> Project Settings -> Environment Variables)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID;

export default function Page() {
  // ---- Auth / API state ----
  const [sb, setSb] = useState<SupabaseClient | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");

  // ---- Backend results ----
  const [health, setHealth] = useState<Health | null>(null);
  const [who, setWho] = useState<Whoami | null>(null);

  // ---- UI state for prediction ----
  const [featureCols, setFeatureCols] = useState<string[]>(DEFAULT_FEATURES);
  const [rows, setRows] = useState<number>(1);
  const [inputs, setInputs] = useState<number[][]>([[0, 0, 0]]);
  const [outputs, setOutputs] = useState<number[] | null>(null);
  const [csvResultUrl, setCsvResultUrl] = useState<string | null>(null);

  // ---- Metrics ----
  const [metrics, setMetrics] = useState<MetricRow[]>([]);

  // Keep inputs matrix sized to rows x featureCols.length
  useEffect(() => {
    setInputs(Array.from({ length: rows }, () => Array(featureCols.length).fill(0)));
  }, [rows, featureCols.length]);

  // Lazy-create Supabase client in the browser only
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!SUPABASE_URL || !SUPABASE_ANON) return; // render a banner below
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      if (!cancelled) setSb(client);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Track auth token
  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [sb]);

  // Health / Whoami
  const checkHealth = async () => setHealth(await apiJson<Health>("/health"));
  const checkWhoami = async () => {
    if (!token) return;
    setWho(await apiJson<Whoami>("/whoami", token));
  };

  // Predict (JSON)
  const doPredict = async () => {
    if (!token) return alert("Login first.");
    const res = await apiJson<PredictOut>("/predict", token, "POST", { inputs });
    setOutputs(res.outputs);
  };

  // Predict (CSV upload)
  const onCsvFile = async (file: File) => {
    if (!token) return alert("Login first.");
    const blob = await apiCsv("/predict_csv", file, token);
    setCsvResultUrl(URL.createObjectURL(blob));
  };

  // Load metrics (anonymous read; RLS can still filter by project)
  useEffect(() => {
    if (!sb) return;
    (async () => {
      let q = sb
        .from("usage_logs")
        .select("created_at, latency_ms, cost_usd")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (PROJECT_ID) q = q.eq("project_id", PROJECT_ID);
      const { data, error } = await q;
      if (!error && data) setMetrics(data as MetricRow[]);
    })();
  }, [sb]);

  // Derived KPIs from usage_logs
  const { p95All, total, totalCost } = useMemo(() => {
    if (!metrics.length) return { p95All: 0, total: 0, totalCost: 0 };
    const p = (arr: number[], q: number) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const idx = Math.floor((s.length - 1) * q);
      return s[idx];
    };
    const p95All = p(metrics.map((r) => Number(r.latency_ms ?? 0)), 0.95);
    const totalCost = metrics.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    return { p95All, total: metrics.length, totalCost };
  }, [metrics]);

  const envMissing = !SUPABASE_URL || !SUPABASE_ANON;

  return (
    <main className="space-y-8">
      {/* Env warning (build-safe) */}
      {envMissing && (
        <div className="card p-4">
          <div className="text-sm">
            <b>Missing env vars:</b> Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your environment (Vercel → Project Settings → Environment
            Variables). Then redeploy.
          </div>
        </div>
      )}

      {/* Authentication */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Authentication</h2>
          {token ? (
            <button className="btn" onClick={() => sb?.auth.signOut()}>
              Sign out
            </button>
          ) : null}
        </div>

        {!token ? (
          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            <div>
              <div className="label">Email</div>
              <input
                className="input w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <div className="label">Password</div>
              <input
                className="input w-full"
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <button
                className="btn"
                onClick={async () => {
                  if (!sb) return;
                  const { error } = await sb.auth.signInWithPassword({ email, password: pwd });
                  if (error) alert(error.message);
                }}
                disabled={!sb}
              >
                Sign in
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex gap-3">
            <button className="btn" onClick={checkHealth}>
              Check Health
            </button>
            <button className="btn" onClick={checkWhoami}>
              Who am I
            </button>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <pre className="card p-3 text-sm">{health ? JSON.stringify(health, null, 2) : "—"}</pre>
          <pre className="card p-3 text-sm">{who ? JSON.stringify(who, null, 2) : "—"}</pre>
        </div>
      </section>

      {/* Single / small-batch predictions */}
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
              onChange={(e) =>
                setFeatureCols(
                  e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
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
                    setInputs((prev) =>
                      prev.map((r, ri) => (ri === i ? r.map((x, rj) => (rj === j ? val : x)) : r))
                    );
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

      {/* CSV batch predictions */}
      <section className="card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Batch CSV</h2>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onCsvFile(f);
          }}
        />
        {csvResultUrl && (
          <a className="btn mt-3" download="predictions.csv" href={csvResultUrl}>
            Download predictions.csv
          </a>
        )}
      </section>

      {/* Simple KPIs */}
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

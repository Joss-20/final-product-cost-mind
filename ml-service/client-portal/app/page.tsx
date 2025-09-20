"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiCsv, apiJson } from "@/lib/api";

// ===== Types =====
type Health = { ok: boolean; model: string; feature_columns?: string[] };
type Whoami = { user_id: string };
type PredictOut = { outputs: number[] };

type MetricRow = {
  created_at: string;
  latency_ms?: number | null;
  cost_usd?: number | null;
};

// ===== Public env (Vercel → Project Settings → Environment Variables) =====
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID;

// ===== UI helpers (pure Tailwind, no extra deps) =====
function Card(
  props: React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>
) {
  const { className = "", ...rest } = props;
  return (
    <div
      className={
        "rounded-2xl border border-slate-200/70 bg-white/70 shadow-sm backdrop-blur " +
        className
      }
      {...rest}
    />
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold tracking-tight text-slate-800">{children}</h2>
  );
}

function Button(
  props: React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>
) {
  const { className = "", ...rest } = props;
  return (
    <button
      className={
        "inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-white " +
        "shadow-sm ring-1 ring-inset ring-indigo-500/30 transition hover:bg-indigo-700 disabled:opacity-50 " +
        className
      }
      {...rest}
    />
  );
}

function MutedButton(
  props: React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>
) {
  const { className = "", ...rest } = props;
  return (
    <button
      className={
        "inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-700 " +
        "shadow-sm transition hover:bg-slate-50 disabled:opacity-50 " +
        className
      }
      {...rest}
    />
  );
}

function Input(
  props: React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>
) {
  const { className = "", ...rest } = props;
  return (
    <input
      className={
        "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none " +
        "focus:border-indigo-400 focus:ring-0 " +
        className
      }
      {...rest}
    />
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-xs font-medium text-slate-600">{children}</div>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
      {children}
    </span>
  );
}

function KPI({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">{label}</div>
        {hint ? <span className="text-[10px] text-slate-400">{hint}</span> : null}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function Table({
  headers,
  rows,
  maxHeight = 360,
}: {
  headers: string[];
  rows: (string | number)[][];
  maxHeight?: number;
}) {
  return (
    <div
      className="overflow-auto rounded-xl border border-slate-200 shadow-sm"
      style={{ maxHeight }}
    >
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-slate-700">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white">
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-white even:bg-slate-50/40">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 text-slate-700">
                  {String(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===== Page =====
export default function Page() {
  // Auth / API state
  const [sb, setSb] = useState<SupabaseClient | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");

  // Backend results
  const [health, setHealth] = useState<Health | null>(null);
  const [who, setWho] = useState<Whoami | null>(null);

  // Prediction UI state
  const [featureCols, setFeatureCols] = useState<string[]>(["f1", "f2", "f3"]);
  const [rows, setRows] = useState<number>(3);
  const [inputs, setInputs] = useState<number[][]>([
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]);
  const [outputs, setOutputs] = useState<number[] | null>(null);

  // CSV
  const [csvResultUrl, setCsvResultUrl] = useState<string | null>(null);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]); // first rows

  // Metrics
  const [metrics, setMetrics] = useState<MetricRow[]>([]);

  // Keep inputs matrix sized to rows x featureCols.length
  useEffect(() => {
    setInputs((prev) =>
      Array.from({ length: rows }, (_, i) =>
        Array.from({ length: featureCols.length }, (_, j) => prev[i]?.[j] ?? 0)
      )
    );
  }, [rows, featureCols.length]);

  // Build-only warning for missing env
  const envMissing = !SUPABASE_URL || !SUPABASE_ANON;

  // Lazy-create Supabase client in the browser only
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!SUPABASE_URL || !SUPABASE_ANON) return;
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

  // Auto-load /health and sync feature columns
  useEffect(() => {
    (async () => {
      try {
        const h = await apiJson<Health>("/health");
        setHealth(h);
        if (Array.isArray(h.feature_columns) && h.feature_columns.length) {
          setFeatureCols(h.feature_columns);
          setRows(3);
          setInputs([
            Array(h.feature_columns.length).fill(0),
            Array(h.feature_columns.length).fill(0),
            Array(h.feature_columns.length).fill(0),
          ]);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Buttons
  const checkHealth = async () => setHealth(await apiJson<Health>("/health"));
  const checkWhoami = async () => {
    if (!token) return;
    setWho(await apiJson<Whoami>("/whoami", token));
  };

  const doPredict = async () => {
    if (!token) return alert("Login first.");
    const res = await apiJson<PredictOut>("/predict", token, "POST", { inputs });
    setOutputs(res.outputs);
  };

  const onCsvFile = async (file: File) => {
    if (!token) return alert("Login first.");
    const blob = await apiCsv("/predict_csv", file, token);
    setCsvResultUrl(URL.createObjectURL(blob));
    // Preview first 25 rows of returned CSV
    const text = await blob.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const preview = lines.slice(0, 26).map((ln) => ln.split(",").map((s) => s.trim()));
    setCsvPreview(preview);
  };

  const buildSampleCsv = (cols: string[]) => {
    const header = (cols.length ? cols : ["f1", "f2", "f3"]).join(",");
    const row1 = (cols.length ? cols : ["f1", "f2", "f3"]).map((_c, i) => (i % 2 === 0 ? 0.5 : 1.0)).join(",");
    const row2 = (cols.length ? cols : ["f1", "f2", "f3"]).map((_c, i) => (i + 1).toString()).join(",");
    return [header, row1, row2].join("\n");
  };

  // Metrics (simple read; RLS can restrict)
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

  // KPIs
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white">
      {/* ===== Top Nav / Hero ===== */}
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold shadow-sm">
              ML
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight">Client Portal</div>
              <div className="text-xs text-slate-500">
                {health?.model ? `Model: ${health.model}` : "—"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {token ? (
              <MutedButton onClick={() => sb?.auth.signOut()}>Sign out</MutedButton>
            ) : null}
          </div>
        </div>
      </header>

      {/* ===== Main ===== */}
      <main className="mx-auto max-w-7xl px-4 py-8 space-y-8">
        {/* Environment warning */}
        {envMissing && (
          <Card className="p-4">
            <div className="text-sm">
              <b>Missing env vars:</b> Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and {" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your environment (Vercel → Project Settings → Environment
              Variables). Then redeploy.
            </div>
          </Card>
        )}

        {/* Row 1: Auth + Status */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <SectionTitle>Authentication</SectionTitle>
              {token ? <Badge>Signed in</Badge> : <Badge>Guest</Badge>}
            </div>

            {!token ? (
              <div className="mt-6 grid gap-4">
                <div>
                  <Label>Email</Label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    onClick={async () => {
                      if (!sb) return;
                      const { error } = await sb.auth.signInWithPassword({ email, password: pwd });
                      if (error) alert(error.message);
                    }}
                    disabled={!sb}
                  >
                    Sign in
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex flex-wrap gap-3">
                <Button onClick={checkHealth}>Check Health</Button>
                <MutedButton onClick={checkWhoami}>Who am I</MutedButton>
              </div>
            )}

            <div className="mt-6 grid grid-cols-1 gap-4">
              <div>
                <Label>Health</Label>
                <pre className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                  {health ? JSON.stringify(health, null, 2) : "—"}
                </pre>
              </div>
              <div>
                <Label>Identity</Label>
                <pre className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                  {who ? JSON.stringify(who, null, 2) : "—"}
                </pre>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <SectionTitle>Playground</SectionTitle>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label>Rows</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={rows}
                  onChange={(e) => setRows(parseInt(e.target.value || "1", 10))}
                />
              </div>
              <div>
                <Label>Feature columns (comma-separated)</Label>
                <Input
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

            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <div className="mb-2 text-xs text-slate-500">Enter feature values:</div>
              <div className="space-y-2">
                {inputs.map((row, i) => (
                  <div key={i} className="flex flex-wrap gap-2">
                    {row.map((v, j) => (
                      <Input
                        key={j}
                        type="number"
                        className="w-28"
                        value={Number.isFinite(v) ? v : 0}
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

              <div className="mt-3 flex flex-wrap gap-2">
                <Button disabled={!token} onClick={doPredict}>
                  Predict
                </Button>
                <MutedButton onClick={() => setInputs((prev) => prev.map((r) => r.map(() => 0)))}>
                  Clear
                </MutedButton>
                <MutedButton
                  onClick={() =>
                    setInputs((prev) => prev.map((r) => r.map(() => +(Math.random() * 2 - 1).toFixed(3))))
                  }
                >
                  Randomize
                </MutedButton>
              </div>
            </div>

            {outputs && (
              <div className="mt-4">
                <div className="mb-2 text-sm font-medium text-slate-700">Prediction preview</div>
                <Table
                  headers={[...featureCols, "prediction"]}
                  rows={inputs.map((row, idx) => [...row, outputs[idx] ?? ""])}
                />
              </div>
            )}
          </Card>
        </div>

        {/* Row 2: CSV Batch */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <SectionTitle>Batch CSV</SectionTitle>
            <Badge>{featureCols.length} features</Badge>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center">
              <span className="cursor-pointer rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50">
                <input
                  className="hidden"
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onCsvFile(f);
                  }}
                />
                Upload CSV…
              </span>
            </label>
            <a
              className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
              download="sample.csv"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(buildSampleCsv(featureCols))}`}
            >
              Download sample.csv
            </a>
            {csvResultUrl && (
              <a
                className="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
                download="predictions.csv"
                href={csvResultUrl}
              >
                Download predictions.csv
              </a>
            )}
          </div>

          {csvPreview.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-sm font-medium text-slate-700">predictions.csv (preview)</div>
              <Table headers={csvPreview[0]} rows={csvPreview.slice(1, 26)} maxHeight={420} />
              <div className="mt-2 text-xs text-slate-500">
                Showing first {Math.min(25, csvPreview.length - 1)} rows.
              </div>
            </div>
          )}
        </Card>

        {/* Row 3: KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KPI label="Total requests" value={String(total)} />
          <KPI label="p95 latency (ms)" value={String(p95All | 0)} />
          <KPI label="Cost ($)" value={totalCost.toFixed(4)} />
        </div>
      </main>

      {/* Subtle gradient footer accent */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[-10rem] z-[-1] h-[20rem] bg-gradient-to-t from-indigo-100/60 to-transparent blur-2xl" />
    </div>
  );
}

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

// ===== Public env =====
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID;

// ===== Minimal in-file UI helpers (no extra imports) =====
function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className = "", ...rest } = props;
  return (
    <div
      className={
        "rounded-2xl border border-slate-200/70 bg-white/70 shadow-sm backdrop-blur p-6 " +
        className
      }
      {...rest}
    />
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}
function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }
) {
  const { className = "", variant = "primary", ...rest } = props;
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";
  const style =
    variant === "primary"
      ? "bg-indigo-600 text-white shadow-sm ring-1 ring-inset ring-indigo-500/30 hover:bg-indigo-700"
      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return <button className={`${base} ${style} ${className}`} {...rest} />;
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      className={
        "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-0 " +
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
    <div className="overflow-auto rounded-xl border border-slate-200 shadow-sm" style={{ maxHeight }}>
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
function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

// ===== Page =====
export default function Page() {
  // Auth / API
  const [sb, setSb] = useState<SupabaseClient | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");

  // Backend results
  const [health, setHealth] = useState<Health | null>(null);
  const [who, setWho] = useState<Whoami | null>(null);

  // Prediction state
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
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);

  // Metrics
  const [metrics, setMetrics] = useState<MetricRow[]>([]);

  // maintain matrix dims
  useEffect(() => {
    setInputs((prev) =>
      Array.from({ length: rows }, (_, i) =>
        Array.from({ length: featureCols.length }, (_, j) => prev[i]?.[j] ?? 0)
      )
    );
  }, [rows, featureCols.length]);

  // supabase client (browser only)
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

  // auth token tracking
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

  // auto health + sync feature columns
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

  // simple actions
  const checkHealth = async () => setHealth(await apiJson<Health>("/health"));
  const checkWhoami = async () => {
    if (!token) return;
    setWho(await apiJson<Whoami>("/whoami", token));
  };

  const doPredict = async () => {
    if (!token) {
      alert("Login first.");
      return;
    }
    const res = await apiJson<PredictOut>("/predict", token, "POST", { inputs });
    setOutputs(res.outputs);
  };

  const onCsvFile = async (file: File) => {
    if (!token) {
      alert("Login first.");
      return;
    }
    const blob = await apiCsv("/predict_csv", file, token);
    setCsvResultUrl(URL.createObjectURL(blob));
    const text = await blob.text();
    const lines = text.split(/\r?\n/).filter((ln) => ln.length > 0);
    const preview: string[][] = lines.slice(0, 26).map((ln) => ln.split(",").map((s) => s.trim()));
    setCsvPreview(preview);
  };

  const buildSampleCsv = (cols: string[]) => {
    const c = cols.length ? cols : ["f1", "f2", "f3"];
    const header = c.join(",");
    const row1 = c.map((_col, i) => (i % 2 === 0 ? "0.5" : "1.0")).join(",");
    const row2 = c.map((_col, i) => String(i + 1)).join(",");
    return [header, row1, row2].join("\n");
  };

  // metrics load
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
    const percentile = (arr: number[], q: number) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const idx = Math.floor((s.length - 1) * q);
      return s[idx];
    };
    const p95 = percentile(metrics.map((r) => Number(r.latency_ms ?? 0)), 0.95);
    const cost = metrics.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    return { p95All: p95, total: metrics.length, totalCost: cost };
  }, [metrics]);

  const envMissing = !SUPABASE_URL || !SUPABASE_ANON;

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white">
      {/* Header */}
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
              <Button variant="ghost" onClick={() => sb?.auth.signOut()}>
                Sign out
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 py-8 space-y-8">
        {envMissing && (
          <Card>
            <div className="text-sm">
              <b>Missing env vars:</b> Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your environment, then redeploy.
            </div>
          </Card>
        )}

        {/* Row 1: Auth + Status */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
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
                    onChange={(e) => setEmail(e.currentTarget.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={pwd}
                    onChange={(e) => setPwd(e.currentTarget.value)}
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
                <Button variant="ghost" onClick={checkWhoami}>
                  Who am I
                </Button>
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

          {/* Playground */}
          <Card>
            <SectionTitle>Playground</SectionTitle>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label>Rows</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={rows}
                  onChange={(e) => setRows(parseInt(e.currentTarget.value || "1", 10))}
                />
              </div>
              <div>
                <Label>Feature columns (comma-separated)</Label>
                <Input
                  value={featureCols.join(",")}
                  onChange={(e) =>
                    setFeatureCols(
                      e.currentTarget.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter((s) => s.length > 0)
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
                          const val = parseFloat(e.currentTarget.value || "0");
                          setInputs((prev) =>
                            prev.map((r, ri) =>
                              ri === i ? r.map((x, rj) => (rj === j ? val : x)) : r
                            )
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
                <Button
                  variant="ghost"
                  onClick={() => setInputs((prev) => prev.map((r) => r.map(() => 0)))}
                >
                  Clear
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setInputs((prev) =>
                      prev.map((r) => r.map(() => +(Math.random() * 2 - 1).toFixed(3)))
                    )
                  }
                >
                  Randomize
                </Button>
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

        {/* CSV */}
        <Card>
          <div className="flex items-center justify-between">
            <SectionTitle>Batch CSV</SectionTitle>
            <Badge>{featureCols.length} features</Badge>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Drop/Upload */}
            <label className="inline-flex items-center">
              <span className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-slate-700 hover:bg-slate-50">
                <input
                  className="hidden"
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) void onCsvFile(f);
                  }}
                />
                Upload CSV…
              </span>
            </label>

            {/* Sample */}
            <a
              className="flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
              download="sample.csv"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(buildSampleCsv(featureCols))}`}
            >
              Download sample.csv
            </a>

            {/* Result */}
            {csvResultUrl && (
              <a
                className="flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
                download="predictions.csv"
                href={csvResultUrl}
              >
                Download predictions.csv
              </a>
            )}
          </div>

          {/* CSV Preview */}
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

        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KPI label="Total requests" value={String(total)} />
          <KPI label="p95 latency (ms)" value={String(p95All | 0)} />
          <KPI label="Cost ($)" value={totalCost.toFixed(4)} />
        </div>
      </main>

      {/* Soft gradient accents */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[-10rem] z-[-1] h-[20rem] bg-gradient-to-t from-indigo-100/60 to-transparent blur-2xl" />
    </div>
  );
}

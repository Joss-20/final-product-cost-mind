'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { apiJson, apiCsv } from '@/lib/api';

type Health = { ok: boolean; model: string };
type Whoami = { user_id: string };
type PredictOut = { outputs: number[] };
const FEATURE_COLUMNS_DEFAULT = ['f1','f2','f3'];

export default function Page() {
  const [email, setEmail] = useState(''); const [pwd, setPwd] = useState('');
  const [token, setToken] = useState<string|null>(null);
  const [health, setHealth] = useState<Health|null>(null);
  const [who, setWho] = useState<Whoami|null>(null);

  const [featureCols, setFeatureCols] = useState(FEATURE_COLUMNS_DEFAULT);
  const [rows, setRows] = useState(1);
  const [inputs, setInputs] = useState<number[][]>([[0,0,0]]);
  const [outputs, setOutputs] = useState<number[]|null>(null);
  const [csvResultUrl, setCsvResultUrl] = useState<string|null>(null);

  useEffect(() => {
    setInputs(Array.from({length: rows}, () => Array(featureCols.length).fill(0)));
  }, [rows, featureCols.length]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setToken(s?.access_token ?? null));
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  const onLogin  = async () => { const { error } = await supabase.auth.signInWithPassword({ email, password: pwd }); if (error) alert(error.message); };
  const onLogout = async () => { await supabase.auth.signOut(); };

  const checkHealth = async () => setHealth(await apiJson<Health>('/health'));
  const checkWhoami = async () => token && setWho(await apiJson<Whoami>('/whoami', token));

  const doPredict = async () => {
    if (!token) return alert('Login first');
    const res = await apiJson<PredictOut>('/predict', token, 'POST', { inputs });
    setOutputs(res.outputs);
  };

  const doPredictCsv = async (file: File) => {
    if (!token) return alert('Login first');
    const blob = await apiCsv('/predict_csv', file, token);
    setCsvResultUrl(URL.createObjectURL(blob));
  };

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-semibold">🔮 ML Client Portal</h1>

      <section className="p-4 rounded border">
        <h2 className="font-semibold mb-2">Auth</h2>
        {token ? (
          <button className="px-3 py-1 border rounded" onClick={onLogout}>Sign out</button>
        ) : (
          <div className="space-y-2">
            <input className="border p-2 w-full" placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input className="border p-2 w-full" type="password" placeholder="password" value={pwd} onChange={e=>setPwd(e.target.value)} />
            <button className="px-3 py-1 border rounded" onClick={onLogin}>Sign in</button>
          </div>
        )}
      </section>

      <section className="p-4 rounded border grid grid-cols-2 gap-4">
        <div>
          <h3 className="font-semibold">Health</h3>
          <button className="px-2 py-1 border rounded mb-2" onClick={checkHealth}>Check</button>
          <pre className="text-sm bg-gray-50 p-2 rounded">{health ? JSON.stringify(health,null,2) : '—'}</pre>
        </div>
        <div>
          <h3 className="font-semibold">Who am I</h3>
          <button className="px-2 py-1 border rounded mb-2" onClick={checkWhoami} disabled={!token}>Check</button>
          <pre className="text-sm bg-gray-50 p-2 rounded">{who ? JSON.stringify(who,null,2) : '—'}</pre>
        </div>
      </section>

      <section className="p-4 rounded border space-y-3">
        <h2 className="font-semibold">Single / Small-batch</h2>
        <div className="flex gap-2 items-center">
          <label>Rows</label>
          <input type="number" min={1} max={50} className="border p-1 w-24" value={rows} onChange={e=>setRows(parseInt(e.target.value||'1',10))}/>
          <label>Features (comma)</label>
          <input className="border p-1 flex-1" value={featureCols.join(',')} onChange={e=>setFeatureCols(e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} />
        </div>
        {inputs.map((row, i) => (
          <div key={i} className="flex gap-2">
            {row.map((v, j) => (
              <input key={j} className="border p-1 w-28" type="number" value={v}
                onChange={e=>{
                  const val = parseFloat(e.target.value||'0');
                  setInputs(prev => prev.map((r, ri)=> ri===i ? r.map((x, rj)=> rj===j ? val : x) : r));
                }}
                placeholder={featureCols[j] ?? `x${j}`}
              />
            ))}
          </div>
        ))}
        <button className="px-3 py-1 border rounded" onClick={doPredict} disabled={!token}>Predict</button>
        {outputs && <pre className="text-sm bg-gray-50 p-2 rounded">{JSON.stringify({outputs}, null, 2)}</pre>}
      </section>

      <section className="p-4 rounded border space-y-3">
        <h2 className="font-semibold">Batch CSV</h2>
        <input type="file" accept=".csv" onChange={e=>{ const f=e.target.files?.[0]; if (f) void doPredictCsv(f);} } />
        {csvResultUrl && <a className="inline-block px-3 py-1 border rounded" download="predictions.csv" href={csvResultUrl}>Download predictions.csv</a>}
      </section>

      <Metrics />
    </main>
  );
}

function Metrics() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    const load = async () => {
      const { supabase } = await import('@/lib/supabaseClient');
      const pid = process.env.NEXT_PUBLIC_PROJECT_ID;
      let q = supabase.from('usage_logs').select('created_at, latency_ms, cost_usd').order('created_at', {ascending:false}).limit(500);
      if (pid) q = q.eq('project_id', pid);
      const { data, error } = await q;
      if (!error && data) setRows(data);
    };
    void load();
  }, []);
  return (
    <section className="p-4 rounded border space-y-2">
      <h2 className="font-semibold">Metrics</h2>
      {rows.length ? <pre className="text-sm bg-gray-50 p-2 rounded">{JSON.stringify(rows.slice(0,5), null, 2)}{rows.length>5?'...':''}</pre> : 'No usage yet.'}
    </section>
  );
}

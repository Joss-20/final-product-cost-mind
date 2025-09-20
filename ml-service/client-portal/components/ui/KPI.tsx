export function KPI({ label, value, hint }: { label: string; value: string; hint?: string }) {
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
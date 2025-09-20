import * as React from "react";


export function Table({
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
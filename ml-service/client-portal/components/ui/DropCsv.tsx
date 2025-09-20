import * as React from "react";


type Props = {
onFile: (file: File) => void | Promise<void>;
};


export function DropCsv({ onFile }: Props) {
const [dragOver, setDragOver] = React.useState(false);
const inputRef = React.useRef<HTMLInputElement | null>(null);


const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
e.preventDefault();
setDragOver(false);
const f = e.dataTransfer.files?.[0];
if (f && f.name.toLowerCase().endsWith(".csv")) onFile(f);
};


return (
<div
onDragOver={(e) => {
e.preventDefault();
setDragOver(true);
}}
onDragLeave={() => setDragOver(false)}
onDrop={onDrop}
className={`flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-slate-600 transition ${
dragOver ? "border-brand/60 bg-brand/5" : "border-slate-300 bg-white hover:bg-slate-50"
}`}
onClick={() => inputRef.current?.click()}
role="button"
aria-label="Upload CSV"
>
<input
ref={inputRef}
className="hidden"
type="file"
accept=".csv"
onChange={(e) => {
const f = e.target.files?.[0];
if (f) void onFile(f);
}}
/>
<div className="text-sm"><b>Drop CSV</b> here or click to upload</div>
</div>
);
}
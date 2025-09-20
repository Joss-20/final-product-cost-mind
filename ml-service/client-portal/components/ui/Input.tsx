import * as React from "react";


export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
return (
<input
className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand/60 focus:ring-0 ${className}`}
{...props}
/>
);
}


export function Label({ children }: { children: React.ReactNode }) {
return <div className="mb-1 text-xs font-medium text-slate-600">{children}</div>;
}
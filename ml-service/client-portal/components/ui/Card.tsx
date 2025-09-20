import * as React from "react";


export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
return <div className={`card-glass p-6 ${className}`} {...props} />;
}


export function SectionTitle({ children }: { children: React.ReactNode }) {
return <h2 className="text-lg font-semibold tracking-tight text-slate-800">{children}</h2>;
}


export function Badge({ children }: { children: React.ReactNode }) {
return (
<span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
{children}
</span>
);
}
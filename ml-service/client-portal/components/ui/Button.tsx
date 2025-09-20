import * as React from "react";


type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
variant?: "primary" | "ghost" | "danger" | "success";
};


export function Button({ variant = "primary", className = "", ...props }: BtnProps) {
const base =
"inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";
const styles: Record<string, string> = {
primary:
"bg-brand text-white shadow-sm ring-1 ring-inset ring-brand/30 hover:bg-brand/90",
ghost:
"border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
danger:
"bg-red-600 text-white hover:bg-red-700",
success:
"bg-emerald-600 text-white hover:bg-emerald-700",
};
return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}
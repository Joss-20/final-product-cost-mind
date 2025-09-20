import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";


const inter = Inter({ subsets: ["latin"] });


export const metadata: Metadata = {
title: "Client Portal",
description: "Model predictions & analytics",
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
return (
<html lang="en">
<body className={inter.className}>
{/* soft gradient accents */}
<div className="pointer-events-none fixed inset-0 z-[-1]">
<div className="absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-indigo-200/40 blur-[100px]" />
<div className="absolute bottom-[-10rem] left-10 h-64 w-[28rem] rounded-full bg-indigo-100/50 blur-[100px]" />
</div>
{children}
</body>
</html>
);
}
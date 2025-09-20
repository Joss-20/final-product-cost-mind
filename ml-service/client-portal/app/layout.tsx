export const metadata = { title: 'Client Portal', description: 'ML client portal' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

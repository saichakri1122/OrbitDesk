import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'OrbitDesk | Support Desk', description: 'Customer support ticket management workspace' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

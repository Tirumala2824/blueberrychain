import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BlueberryChain OS',
  description:
    'Autonomous chat-driven agriculture supply chain platform for the organic blueberry cold chain',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

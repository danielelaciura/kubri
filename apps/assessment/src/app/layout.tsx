import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kubri Assessment",
  description: "Valuta le tue competenze con Kubri",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body className="min-h-dvh bg-white text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}

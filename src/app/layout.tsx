import type { Metadata } from "next";
import { Nunito, Quattrocento } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const quattrocento = Quattrocento({
  variable: "--font-quattrocento",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kubri Dashboard",
  description: "Kubri Dashboard - Gestione candidati",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`${nunito.variable} ${quattrocento.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

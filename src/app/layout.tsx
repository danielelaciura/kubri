import type { Metadata } from "next";
import { Nunito_Sans, Jost } from "next/font/google";
import "./globals.css";

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  weight: ['400', '500', '600', '700', '800'],
  subsets: ["latin"],
});

const jost = Jost({
  variable: "--font-jost",
  weight: ['500'],
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
      className={`${nunitoSans.variable} ${jost.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

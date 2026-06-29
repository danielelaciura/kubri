import type { Metadata } from "next";
import Image from "next/image";
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
      <body className="flex min-h-dvh flex-col bg-white text-neutral-900 antialiased">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-200 bg-white px-5 py-3 sm:px-6">
          <a
            href="https://www.kubri.it"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-[#534AB7] transition-colors hover:text-[#3C3489]"
          >
            <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            visita il sito di Kubri
          </a>
          <div className="flex items-center gap-2">
            <Image src="/kubri-logo.png" alt="" width={108} height={112} className="h-6 w-auto" priority />
            <span className="text-[15px] font-semibold text-[#3C3489]">kubri</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}

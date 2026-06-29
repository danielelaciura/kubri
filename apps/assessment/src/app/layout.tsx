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
      <body className="flex min-h-dvh flex-col bg-white text-neutral-900 antialiased">
        <header className="flex shrink-0 items-center px-5 py-3.5 sm:px-6">
          <a
            href="https://www.kubri.it"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-[#534AB7] transition-colors hover:text-[#3C3489]"
          >
            visita il sito di Kubri
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </a>
        </header>
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { DemoProvider } from "@/lib/store";
import { TourBar } from "@/components/tour-bar";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kubri x APL — demo",
  description: "Prototipo dimostrativo: l'agenzia per il lavoro attiva la sua rete di associazioni con Kubri.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={poppins.variable}>
      <body className="min-h-dvh bg-surface font-sans text-[14px] leading-normal text-ink">
        <DemoProvider>
          {children}
          <TourBar />
        </DemoProvider>
      </body>
    </html>
  );
}

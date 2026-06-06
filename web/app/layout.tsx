import type { Metadata } from "next";
import "./globals.css";
import RiotDisclaimer from "@/components/RiotDisclaimer";
import DatasetFooter from "@/components/DatasetFooter";

export const metadata: Metadata = {
  title: "DraftLab — Honest draft recommendations for solo queue",
  description:
    "Personalized League of Legends draft tool. Scored on matchups, synergies, and team composition with honest confidence intervals.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 antialiased flex flex-col min-h-screen">
        <RiotDisclaimer />
        <div className="flex-1">{children}</div>
        <DatasetFooter />
      </body>
    </html>
  );
}

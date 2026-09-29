import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "BuildERP — Specifications to submittals",
  description:
    "A connected workspace for specification documents, source-backed answers, and reviewed submittal registers.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Template Importer",
  description:
    "Import Spectora HTML-text template exports into a structured, editable schema.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

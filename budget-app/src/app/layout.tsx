import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Budget Reporting — Office of Global Inclusion",
  description: "FY26 budget detail, by account.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              Budget Reporting
              <span className="brand-sub">Office of Global Inclusion</span>
            </Link>
            <nav className="topnav">
              <Link href="/">Report</Link>
              <Link href="/upload">Upload</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}

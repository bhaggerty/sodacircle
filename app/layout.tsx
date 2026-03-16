import type { Metadata } from "next";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

const bodyFont = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"]
});

const headingFont = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "700"]
});

export const metadata: Metadata = {
  title: "sodacircle",
  description: "sodacircle helps teams turn hiring briefs into ranked talent pipelines and personalized outreach."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${headingFont.variable}`}>
        {children}
      </body>
    </html>
  );
}

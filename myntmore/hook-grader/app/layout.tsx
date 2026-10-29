import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LinkedIn Hook Grader | Myntmore",
  description: "Score the first two lines of your LinkedIn post out of 100 and get three rewrites.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,500;1,500&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

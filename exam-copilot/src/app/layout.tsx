import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Abhyas AI — Personalized AI Exam Copilot & Study Suite",
  description:
    "An enterprise-grade AI-powered exam preparation copilot for competitive government exams including UPSC, SSC, Banking, Railways, GATE, UGC NET. Features multi-document RAG, AI tutoring, exam simulation, knowledge graphs, and adaptive analytics.",
  keywords:
    "AI exam prep, UPSC preparation, SSC exam, competitive exam, AI tutor, exam copilot",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <head>
        <meta name="theme-color" content="#090909" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
      </head>
      <body className="h-full overflow-hidden bg-[#090909]">{children}</body>
    </html>
  );
}

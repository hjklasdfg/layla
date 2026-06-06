import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { VoiceProviders } from "@/components/VoiceProviders";
import { publicEnv } from "@/lib/config/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Layla — Accessibility Mobility Intelligence",
  description:
    "Compare mobility routes with accessibility, stress, and reliability scores.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#050810] text-slate-200">
        <VoiceProviders agentId={publicEnv.elevenlabsAgentId || undefined}>
          {children}
        </VoiceProviders>
      </body>
    </html>
  );
}

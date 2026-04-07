import type { Metadata, Viewport } from "next";
import { Press_Start_2P } from "next/font/google";
import NavBar from "@/components/NavBar";
import XPBar from "@/components/XPBar";
import "./globals.css";

const pixelFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
});

export const metadata: Metadata = {
  title: "Piano Bud",
  description: "Your retro piano learning companion",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Piano Bud",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${pixelFont.variable} h-full`}>
      <body className="min-h-full flex flex-col pb-20">
        <XPBar />
        <main className="flex-1 flex flex-col page-enter">
          {children}
        </main>
        <NavBar />
      </body>
    </html>
  );
}

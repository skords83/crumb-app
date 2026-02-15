import type { Metadata } from "next";
import { Outfit } from "next/font/google"; // Wir nutzen jetzt nur Outfit
import "./globals.css";
import Navigation from "../components/Navigation"; 

// 1. Schrift konfigurieren
const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

// 2. Metadaten festlegen
export const metadata: Metadata = {
  title: "Crumb - Deine Brot Bibliothek",
  description: "Brotbacken mit System",
};

// 3. Das EINE RootLayout
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning> 
      <body
        className={`${outfit.variable} font-sans antialiased bg-[#fcfcfc]`}
      >
        {/* Die Navigation wird hier einmalig geladen */}
        <Navigation />

        {/* Content-Bereich mit Abständen für den fixierten Header */}
        <main className="md:pt-32 pb-24 md:pb-8">
          {children}
        </main>
      </body>
    </html>
  );
}
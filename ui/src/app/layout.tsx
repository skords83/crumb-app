import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import Script from 'next/script';
import Navigation from "../components/Navigation";
import { ThemeProvider } from "../context/ThemeProvider";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "Crumb - Deine Brot Bibliothek",
  description: "Brotbacken mit System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body
        className={`${outfit.variable} font-sans antialiased bg-[#fcfcfc] dark:bg-gray-900 transition-colors duration-200`}
      >
        <Script id="theme-preload" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var t = localStorage.getItem('theme');
              if (t === 'dark') {
                document.documentElement.classList.add('dark');
              } else if (t === 'light') {
                document.documentElement.classList.remove('dark');
              } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                document.documentElement.classList.add('dark');
              }
            } catch (e) {}
          })();
        ` }} />
        <ThemeProvider>
          <Navigation />
          <main className="md:pt-32 pb-24 md:pb-8">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}

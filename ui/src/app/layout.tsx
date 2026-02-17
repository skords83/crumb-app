import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import Navigation from "../components/Navigation";

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
  <head>
    <script
      dangerouslySetInnerHTML={{
        __html: `
          try {
            if (localStorage.getItem('theme') === 'dark') {
              document.documentElement.classList.add('dark')
            }
          } catch (e) {}
        `,
      }}
    />
  </head>
  <body className={`${outfit.variable} font-sans antialiased transition-colors duration-200`}>
        <Navigation />
        <main className="md:pt-32 pb-24 md:pb-8">
          {children}
        </main>
      </body>
    </html>
  );
}
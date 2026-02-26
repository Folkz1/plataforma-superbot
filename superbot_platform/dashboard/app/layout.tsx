import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import Providers from "@/components/Providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SuperBot Dashboard",
  description: "Painel de controle para gerenciamento de agentes conversacionais",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <Script id="theme-init" strategy="beforeInteractive">{`
          (function () {
            try {
              var key = 'superbot_theme';
              var stored = localStorage.getItem(key);
              var theme = stored === 'dark' || stored === 'light'
                ? stored
                : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
              var root = document.documentElement;
              root.classList.toggle('dark', theme === 'dark');
              root.setAttribute('data-theme', theme);
            } catch (e) {}
          })();
        `}</Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

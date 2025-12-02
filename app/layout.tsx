import { Metadata } from "next";
import { PropsWithChildren, Suspense } from "react";
import type { Viewport } from "next";
import { Toaster } from "@/components/ui/shadcn/toast";
import { getURL } from "@/utils/helpers";
import { GeistMono } from "geist/font/mono";
import { Roboto_Mono } from "next/font/google";
import ColorStyles from "@/components/shared/color-styles/color-styles";
import Scrollbar from "@/components/ui/scrollbar";
import "styles-marketing/main.css";
import localFont from "next/font/local";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { AuthProvider } from "@/contexts/AuthContext";
import ReferrerCookie from "@/components/shared/referrer-cookie";
import Header from "@/components/shared/header/Header";
import { HeaderProvider } from "@/components/shared/header/HeaderContext";
import "./globals.css";

const suisse = localFont({
  src: [
    {
      path: "../public/fonts/SuisseIntl/400.woff2",
      weight: "400",
    },
    {
      path: "../public/fonts/SuisseIntl/450.woff2",
      weight: "450",
    },
    {
      path: "../public/fonts/SuisseIntl/500.woff2",
      weight: "500",
    },
    {
      path: "../public/fonts/SuisseIntl/600.woff2",
      weight: "600",
    },
    {
      path: "../public/fonts/SuisseIntl/700.woff2",
      weight: "700",
    },
  ],
  variable: "--font-suisse",
  display: "swap",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-roboto-mono",
});
const meta = {
  title: "Open Scouts - AI-Powered Monitoring & Search",
  description:
    "Create AI scouts that continuously search and notify you when they find what you're looking for. Open-source monitoring powered by AI.",
  cardImage: "/og.png",
  robots: "follow, index",
  favicon: "/favicon.png",
  url: getURL(),
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: meta.title,
    description: meta.description,
    referrer: "origin-when-cross-origin",
    keywords: [
      "Open Scouts",
      "AI Monitoring",
      "Web Search",
      "AI",
      "Notifications",
    ],
    authors: [{ name: "Firecrawl team" }],
    creator: "Firecrawl team",
    publisher: "Firecrawl team",
    robots: meta.robots,
    icons: {
      icon: meta.favicon,
      apple: "/favicon.ico",
    },
    metadataBase: new URL(meta.url),
    openGraph: {
      url: meta.url,
      title: meta.title,
      description: meta.description,
      images: [meta.cardImage],
      type: "website",
      siteName: meta.title,
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [meta.cardImage],
    },
  };
}

// To avoid zooming in on mobile
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <ColorStyles />
      </head>
      <body
        className={`${GeistMono.variable} ${robotoMono.variable} ${suisse.variable} font-sans text-accent-black bg-background-base overflow-x-clip`}
      >
        <AuthProvider>
          <CurrencyProvider>
            <HeaderProvider>
              <Header />
              <div className="fixed top-0 z-[2] cmw-container border-x border-border-faint h-screen pointer-events-none" />
              <main className="overflow-x-clip">{children}</main>
            </HeaderProvider>
            <Scrollbar />
            <Suspense>
              <Toaster richColors toastOptions={{ duration: 3000 }} />
            </Suspense>
          </CurrencyProvider>
        </AuthProvider>
        <ReferrerCookie />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
import "./globals.css";
import Header from "@/components/custom/header";

const satoshi = localFont({
  src: [
    {
      path: "../public/fonts/satoshi/Satoshi-Light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "../public/fonts/satoshi/Satoshi-LightItalic.woff2",
      weight: "300",
      style: "italic",
    },
    {
      path: "../public/fonts/satoshi/Satoshi-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/satoshi/Satoshi-Italic.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "../public/fonts/satoshi/Satoshi-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/satoshi/Satoshi-MediumItalic.woff2",
      weight: "500",
      style: "italic",
    },
    {
      path: "../public/fonts/satoshi/Satoshi-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../public/fonts/satoshi/Satoshi-BoldItalic.woff2",
      weight: "700",
      style: "italic",
    },
    {
      path: "../public/fonts/satoshi/Satoshi-Black.woff2",
      weight: "900",
      style: "normal",
    },
    {
      path: "../public/fonts/satoshi/Satoshi-BlackItalic.woff2",
      weight: "900",
      style: "italic",
    },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeepAgent",
  description: "An ai agent built with LangChain DeepAgents, Vercel ai-sdk/langchain adaptor and Assistant-ui",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${satoshi.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">
        <ClerkProvider>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}

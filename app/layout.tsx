import type { Metadata } from "next";
import "@fontsource-variable/syne";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ??
  "https://robotica-social-nagib-tobias.bolha-5905.chatgpt.site";
const normalizedSiteUrl = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
const image = new URL("og.png", normalizedSiteUrl).toString();

export const metadata: Metadata = {
  metadataBase: new URL(normalizedSiteUrl),
  title: "Robótica Social — Nagib × Tobias",
  description: "Uma apresentação em oito atos sobre corpo, presença e relações entre humanos e máquinas.",
  openGraph: {
    title: "Robótica Social",
    description: "Nagib × Tobias — do corpo à presença.",
    type: "website",
    images: [{ url: image, width: 1734, height: 907, alt: "Robótica Social — Nagib × Tobias" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Robótica Social",
    description: "Nagib × Tobias — do corpo à presença.",
    images: [image],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

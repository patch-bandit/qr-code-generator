import type { Metadata, Viewport } from "next";
import "./generator.css";

export const metadata: Metadata = {
  title: "Bandit Codes: free QR codes that stay on your device",
  description:
    "Make a QR code for a link, contact card, Wi-Fi, email, text message, map location or calendar event. Free, no account, no tracking. Everything happens in your browser.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0e0619" };

// In the built site, the browser is told it may not make any network requests.
// (Switched off in development, where the dev server needs a connection.)
const CSP =
  "default-src 'self'; connect-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'none'";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/platypi.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/instrument-sans.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        {process.env.NODE_ENV === "production" && <meta httpEquiv="Content-Security-Policy" content={CSP} />}
      </head>
      <body>{children}</body>
    </html>
  );
}

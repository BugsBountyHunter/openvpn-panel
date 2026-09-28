import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenVPN Panel",
  description: "Web dashboard for OpenVPN servers installed with openvpn-install",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}

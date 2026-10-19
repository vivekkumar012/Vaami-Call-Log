import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vaami | Voice intelligence",
  description: "A colourful command center for voice agent calls",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}

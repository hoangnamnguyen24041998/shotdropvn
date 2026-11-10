import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShotDropVN — Live Event Photo Gallery",
  description:
    "Xem và tải ảnh sự kiện chất lượng gốc theo thời gian thực ngay sau khi chụp.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

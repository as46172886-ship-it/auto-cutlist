import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "系統櫃 AI 拆料｜含門完整料單",
  description: "上傳系統櫃圖面，辨識桶身、內裝、門板、開向與門用五金，再用固定公式產生完整 Excel 料單。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

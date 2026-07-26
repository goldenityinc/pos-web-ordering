import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import AppErrorBoundary from "../components/app-error-boundary";
import { CartProvider } from "../contexts/cart-context";

export const metadata: Metadata = {
  title: "Goldenity Web Ordering",
  description: "Customer web ordering for Goldenity POS",
  formatDetection: {
    telephone: false,
    date: false,
    email: false,
    address: false,
  },
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="id">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <AppErrorBoundary>
          <CartProvider>{children}</CartProvider>
        </AppErrorBoundary>
      </body>
    </html>
  );
}

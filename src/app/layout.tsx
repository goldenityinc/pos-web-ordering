import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import AppErrorBoundary from "../components/app-error-boundary";
import { CartProvider } from "../contexts/cart-context";

export const metadata: Metadata = {
  title: "Goldenity Web Ordering",
  description: "Customer web ordering for Goldenity POS",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="id">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.onerror = function(message, source, lineno, colno, error) {
                alert("CRASH: " + message + "\\nFile: " + source + "\\nLine: " + lineno);
                return false;
              };
              window.addEventListener("unhandledrejection", function(event) {
                alert("PROMISE CRASH: " + (event.reason ? event.reason.toString() : "Unknown"));
              });
            `,
          }}
        />
      </head>
      <body className="bg-slate-50 text-slate-900 antialiased">
        <AppErrorBoundary>
          <CartProvider>{children}</CartProvider>
        </AppErrorBoundary>
      </body>
    </html>
  );
}

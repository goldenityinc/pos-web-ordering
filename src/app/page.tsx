import { Suspense } from "react";
import HomePageClient from "./home-page-client";

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center text-gray-600">
          Memuat halaman...
        </main>
      }
    >
      <HomePageClient />
    </Suspense>
  );
}

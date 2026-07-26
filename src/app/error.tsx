"use client";

import { useEffect, useState } from "react";
import RecoveryScreen from "../components/recovery-screen";
import { clearAppStorage, shouldAutoRecoverFromError } from "../lib/app-storage";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const [autoRecovered, setAutoRecovered] = useState(false);

  useEffect(() => {
    console.error("Route error captured by Next.js error boundary.", error);

    if (shouldAutoRecoverFromError(error)) {
      clearAppStorage();
      setAutoRecovered(true);
    }
  }, [error]);

  return (
    <RecoveryScreen
      title="Halaman gagal dimuat"
      description="Kami menangkap error render atau hydration pada halaman ini. Reset akan menghapus state lokal yang rusak sebelum mencoba memuat ulang."
      isAutoRecovered={autoRecovered}
      error={error}
    />
  );
}

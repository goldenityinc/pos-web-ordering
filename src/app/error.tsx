"use client";

import { useEffect, useRef, useState } from "react";
import RecoveryScreen from "../components/recovery-screen";
import { clearAppStorage, shouldAutoRecoverFromError } from "../lib/app-storage";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const hasAutoResetRef = useRef(false);
  const [autoRecovered, setAutoRecovered] = useState(false);

  useEffect(() => {
    console.error("Route error captured by Next.js error boundary.", error);

    if (!hasAutoResetRef.current && shouldAutoRecoverFromError(error)) {
      hasAutoResetRef.current = true;
      clearAppStorage();
      setAutoRecovered(true);
      reset();
    }
  }, [error, reset]);

  const handleReset = () => {
    clearAppStorage();
    reset();
  };

  return (
    <RecoveryScreen
      title="Halaman gagal dimuat"
      description="Kami menangkap error render atau hydration pada halaman ini. Reset akan menghapus state lokal yang rusak sebelum mencoba memuat ulang."
      isAutoRecovered={autoRecovered}
      onReset={handleReset}
    />
  );
}

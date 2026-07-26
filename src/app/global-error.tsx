"use client";

import { useEffect, useState } from "react";
import RecoveryScreen from "../components/recovery-screen";
import { clearAppStorage, shouldAutoRecoverFromError } from "../lib/app-storage";

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  const [autoRecovered, setAutoRecovered] = useState(false);

  useEffect(() => {
    console.error("Global error captured by Next.js global-error boundary.", error);

    if (shouldAutoRecoverFromError(error)) {
      clearAppStorage();
      setAutoRecovered(true);
    }
  }, [error]);

  return (
    <html lang="id">
      <body>
        <RecoveryScreen
          title="Aplikasi perlu dipulihkan"
          description="Terjadi error fatal di level aplikasi. Reset akan membersihkan state lokal yang korup lalu mencoba memuat ulang aplikasi."
          isAutoRecovered={autoRecovered}
          error={error}
        />
      </body>
    </html>
  );
}

"use client";

type RecoveryScreenProps = {
  title?: string;
  description?: string;
  isAutoRecovered?: boolean;
  actionLabel?: string;
};

export default function RecoveryScreen({
  title = "Aplikasi perlu dipulihkan",
  description = "Terjadi gangguan saat memuat halaman. Data lokal yang bermasalah bisa dibersihkan agar aplikasi dapat dipakai lagi.",
  isAutoRecovered = false,
  actionLabel = "Muat Ulang Halaman",
}: RecoveryScreenProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300">
          Recovery Mode
        </p>
        <h1 className="mt-3 text-2xl font-bold text-white">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-200">{description}</p>

        {isAutoRecovered ? (
          <p className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            Data lokal yang terdeteksi bermasalah sudah dibersihkan otomatis.
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => {
            try {
              // 1. Clear Local & Session Storage
              localStorage.clear();
              sessionStorage.clear();

              // 2. Clear all Cookies
              document.cookie.split(";").forEach((c) => {
                document.cookie = c
                  .replace(/^ +/, "")
                  .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
              });

              // 3. Unregister Service Workers (Kill PWA Cache)
              if ("serviceWorker" in navigator) {
                navigator.serviceWorker.getRegistrations().then(function (registrations) {
                  for (const registration of registrations) {
                    registration.unregister();
                  }
                });
              }
            } catch (e) {
              console.error("Deep wipe failed", e);
            }
            // 4. Force hard reload with timestamp bypass
            window.location.href = "/?reset=" + new Date().getTime();
          }}
          className="mt-6 w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-600"
        >
          {actionLabel}
        </button>
      </div>
    </main>
  );
}

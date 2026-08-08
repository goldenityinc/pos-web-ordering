type MaintenanceScreenProps = {
  title?: string;
  description?: string;
};

export const MAINTENANCE_TITLE = "Sedang Dalam Pemeliharaan";
export const MAINTENANCE_DESCRIPTION =
  "Mohon maaf, sistem order online sedang kami perbarui untuk meningkatkan layanan. Silakan pesan langsung ke kasir.";

export default function MaintenanceScreen({
  title = MAINTENANCE_TITLE,
  description = MAINTENANCE_DESCRIPTION,
}: MaintenanceScreenProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 text-center shadow-2xl backdrop-blur">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-amber-300/30 bg-amber-400/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-10 w-10 text-amber-300"
            aria-hidden="true"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </div>

        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">
          Maintenance Mode
        </p>
        <h1 className="mt-3 text-2xl font-bold text-white">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-200">{description}</p>

        <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs leading-5 text-slate-300">
          Terima kasih atas pengertian Anda. Layanan akan kembali normal setelah pemeliharaan
          selesai.
        </p>
      </div>
    </main>
  );
}

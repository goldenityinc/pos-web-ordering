import dynamicImport from "next/dynamic";

const HomePageClient = dynamicImport(() => import("../home-page-client"), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen flex items-center justify-center text-gray-600">
      Memuat pengaturan...
    </main>
  ),
});

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <HomePageClient forcedMode="settings" />;
}

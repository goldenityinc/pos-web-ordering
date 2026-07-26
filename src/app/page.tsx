import dynamic from "next/dynamic";

const HomePageClient = dynamic(() => import("./home-page-client"), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen flex items-center justify-center text-gray-600">
      Memuat menu...
    </main>
  ),
});

export const dynamic = "force-dynamic";

export default function Page() {
  return <HomePageClient />;
}

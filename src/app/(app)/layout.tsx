import { headers } from "next/headers";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const email = (await headers()).get("x-user-email") ?? "";

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header email={email} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}

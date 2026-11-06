import { AppNav } from "@/components/AppNav";
import { CurrentUserGate } from "@/components/CurrentUser";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <CurrentUserGate>
        <AppNav />
        {children}
      </CurrentUserGate>
    </div>
  );
}

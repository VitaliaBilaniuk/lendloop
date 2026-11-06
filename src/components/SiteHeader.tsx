import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-stone-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-stone-900">
          <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-emerald-700 text-sm text-white">
            ↻
          </span>
          LendLoop
        </Link>
        <div className="flex items-center gap-3">
          <Show when="signed-in">
            <Link href="/browse" className="text-sm font-medium text-stone-700 hover:text-stone-900">
              Open app
            </Link>
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal" forceRedirectUrl="/browse">
              <button className="rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-800">
                Sign in
              </button>
            </SignInButton>
          </Show>
        </div>
      </div>
    </header>
  );
}

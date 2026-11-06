import { Show, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { PublicToolList } from "@/components/PublicToolList";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 text-center sm:py-24">
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">LendLoop</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
          Borrow what you need. Lend what you don&apos;t.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-stone-600">
          A neighborhood board for sharing drills, ladders, tents and pasta makers, with friendly
          reminders so everything finds its way home.
        </p>
        <div className="mt-8">
          <Show when="signed-out">
            <SignInButton mode="modal" forceRedirectUrl="/browse">
              <button className="rounded-lg bg-emerald-700 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-emerald-800">
                Sign in to lend or borrow
              </button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <Link
              href="/browse"
              className="rounded-lg bg-emerald-700 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-emerald-800"
            >
              Go to the board
            </Link>
          </Show>
        </div>
      </section>

      <section className="pb-20">
        <h2 className="mb-4 text-lg font-semibold text-stone-900">Available now</h2>
        <PublicToolList />
      </section>
    </div>
  );
}

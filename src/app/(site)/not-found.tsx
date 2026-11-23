import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-[1280px] place-items-center px-5 pt-24">
      <div className="text-center">
        <p className="label text-signal">Error 404 — no route</p>
        <h1 className="font-display mt-4 text-[clamp(4rem,14vw,10rem)] font-extrabold leading-none">Dropped call.</h1>
        <p className="mx-auto mt-4 max-w-md text-ink-3">That address isn&apos;t registered on the switchboard.</p>
        <Link href="/" className="mt-8 inline-block bg-ink px-5 py-3 text-[14px] font-semibold text-paper transition-colors hover:bg-signal">Back to start</Link>
      </div>
    </main>
  );
}

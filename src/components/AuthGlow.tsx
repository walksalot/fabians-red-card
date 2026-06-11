/**
 * Fixed, very low-opacity atmosphere for the auth screens: a brand-red glow
 * top-center and a faint emerald counter-glow bottom-right. Purely decorative.
 */
export default function AuthGlow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute left-1/2 top-[-180px] h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-brand/[0.2] blur-3xl" />
      <div className="absolute bottom-[-140px] right-[-120px] h-[360px] w-[360px] rounded-full bg-emerald-400/[0.08] blur-3xl" />
    </div>
  );
}

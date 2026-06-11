/** App wordmark with the red-card motif. Server-safe (no hooks). */
export function Brand({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const card =
    size === 'lg' ? 'h-8 w-6 rounded-[4px]' : 'h-5 w-4 rounded-[3px]';
  const text = size === 'lg' ? 'text-2xl' : 'text-base';
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={`${card} inline-block rotate-6 bg-red-600 shadow-[0_2px_10px_rgba(220,38,38,0.45)]`}
      />
      <span className={`${text} font-bold tracking-tight text-zinc-100`}>
        {"Fabian's Red Card"}
      </span>
    </div>
  );
}

export default Brand;

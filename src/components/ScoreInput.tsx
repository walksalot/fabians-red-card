'use client';

/**
 * Big numeric score input for predictions. Value is a string so the field can be
 * empty while typing; the parent validates/converts on save.
 */
export interface ScoreInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  disabled?: boolean;
}

export function ScoreInput({
  label,
  value,
  onChange,
  testId,
  disabled,
}: ScoreInputProps) {
  return (
    <label className="flex flex-1 flex-col items-center gap-1.5">
      <span className="max-w-28 truncate text-xs font-medium text-zinc-400">
        {label}
      </span>
      <input
        data-testid={testId}
        type="number"
        inputMode="numeric"
        min={0}
        max={20}
        step={1}
        placeholder="0"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-14 w-20 rounded-xl border border-zinc-800 bg-zinc-950 text-center text-2xl font-bold text-zinc-100 placeholder:text-zinc-700 focus:border-emerald-400 focus:outline-none disabled:opacity-50"
      />
    </label>
  );
}

export default ScoreInput;

import { useEffect, useState } from 'react';

export function PriceField({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input aria-label={label} type="number" min="0" max="1000000" step="0.01" value={draft} onBlur={() => setDraft(String(value))} onChange={event => {
    const text = event.target.value; setDraft(text);
    if (text.trim() && Number.isFinite(Number(text)) && Number(text) >= 0 && Number(text) <= 1000000) onChange(Number(text));
  }}/>;
}

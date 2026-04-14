'use client';

import { INSTRUMENTS, type Instrument } from '@/lib/audio/synth';

interface Props {
  value: Instrument;
  onChange: (i: Instrument) => void;
}

export default function InstrumentSelector({ value, onChange }: Props) {
  return (
    <>
      {INSTRUMENTS.map(inst => (
        <button
          key={inst.id}
          onClick={() => onChange(inst.id)}
          className={`badge ${value === inst.id ? 'badge-medium ring-1 ring-current' : 'badge-medium opacity-50'}`}
        >
          {inst.label}
        </button>
      ))}
    </>
  );
}

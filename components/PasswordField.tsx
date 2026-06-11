'use client';

import { useState } from 'react';
import { Eye, EyeOff, Dices } from 'lucide-react';
import { generatePassword, passwordStrength } from '@/lib/password';

const STRENGTH = [
  { width: 'w-1/4', color: 'bg-red-400', label: 'Zəif', text: 'text-red-500' },
  { width: 'w-2/4', color: 'bg-orange-400', label: 'Orta', text: 'text-orange-500' },
  { width: 'w-3/4', color: 'bg-yellow-400', label: 'Yaxşı', text: 'text-yellow-600' },
  { width: 'w-full', color: 'bg-green-500', label: 'Güclü', text: 'text-green-600' },
] as const;

export default function PasswordField({
  value,
  onChange,
  placeholder,
  required,
  focusClass = 'focus:ring-amber-500',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  /** Tailwind focus ring class so the field matches each page's accent color. */
  focusClass?: string;
}) {
  const [show, setShow] = useState(false);
  const s = STRENGTH[passwordStrength(value)];
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? '••••••••'}
          required={required}
          className={`w-full border border-stone-200 rounded-xl px-3 py-2.5 pr-[4.5rem] text-sm focus:outline-none focus:ring-2 ${focusClass}`}
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => { onChange(generatePassword()); setShow(true); }}
            title="Güclü şifrə yarat"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
          >
            <Dices className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShow(v => !v)}
            title={show ? 'Gizlət' : 'Göstər'}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {value && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-stone-100 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${s.width} ${s.color}`} />
          </div>
          <span className={`text-[10px] font-medium ${s.text}`}>{s.label}</span>
        </div>
      )}
    </div>
  );
}

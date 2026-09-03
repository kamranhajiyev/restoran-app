'use client';

// Whether this one order has reached the server.
//
// The badge in the corner counts writes; a waiter holding a bill wants to know
// about the order in front of them — is this one safe if the machine dies
// tonight. So the answer belongs on the row, beside the number.
//
// Only the unsent case is drawn. A tick on every order that *is* on the server
// would put a mark on every line of a normal service and teach everyone to stop
// reading them — and it would say least on the busy evening when the queue is
// long and the exceptions are what matter. Absence is the good news.

import { CloudOff } from 'lucide-react';

export default function OrderSyncDot({ unsent }: { unsent: boolean }) {
  if (!unsent) return null;
  return (
    <span
      title="Bu kompüterdə saxlanılır — internet qayıdanda göndəriləcək"
      className="inline-flex items-center text-amber-600 shrink-0"
      aria-label="göndərilməyib"
    >
      <CloudOff className="w-3.5 h-3.5" />
    </span>
  );
}

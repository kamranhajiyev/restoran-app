'use client';

// The one screen that is allowed to make a waiter wait.
//
// A freshly installed till has nothing on it: no menu, no room, no staff. Until
// that first pull finishes there is no till to use, so this blocks — and says
// what it is doing while it does, because a POS that shows a blank screen on its
// first morning gets a phone call, not patience.
//
// Every screen after this one is the opposite: the local copy exists, so nothing
// waits on the network ever again. See the badge in components/SyncStatus.tsx.

import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, TriangleAlert } from 'lucide-react';
import { pullAll, stepList, type StepProgress } from '@/lib/till-sync';

export default function TillSetup({
  companyId,
  onDone,
}: {
  companyId: string;
  /** Called once the machine has enough to open the till. */
  onDone: () => void;
}) {
  const [steps, setSteps] = useState<StepProgress[]>(stepList);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // React runs effects twice in development; the pull is idempotent but doing it
  // twice makes the screen jump about, and doubles the wait it exists to explain.
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    setFailed(false);

    void pullAll(companyId, setSteps).then(({ ok }) => {
      running.current = false;
      if (ok) onDone();
      else setFailed(true);
    });
  }, [companyId, attempt, onDone]);

  const done = steps.filter(s => s.state === 'done').length;
  const pct = Math.round((done / Math.max(steps.length, 1)) * 100);

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-stone-800">Proqram hazırlanır</h1>
        <p className="mt-1 text-sm text-stone-500">
          Restoranın məlumatları bu kompüterə yüklənir. Bu, yalnız bir dəfə baş verir.
        </p>

        <div className="mt-5 h-1.5 w-full rounded-full bg-stone-200 overflow-hidden">
          <div
            className="h-full bg-emerald-600 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        <ul className="mt-5 space-y-2">
          {steps.map(s => (
            <li key={s.id} className="flex items-center gap-3 text-sm">
              <span className="w-4 shrink-0 text-stone-400">
                {s.state === 'done' && <Check className="w-4 h-4 text-emerald-600" />}
                {s.state === 'running' && <RefreshCw className="w-4 h-4 animate-spin text-stone-500" />}
                {s.state === 'failed' && <TriangleAlert className="w-4 h-4 text-red-500" />}
                {s.state === 'pending' && <span className="block w-1 h-1 rounded-full bg-stone-300 mx-auto" />}
              </span>
              <span className={s.state === 'pending' ? 'text-stone-400' : 'text-stone-700'}>
                {s.label}
              </span>
              <span className="ml-auto tabular-nums text-xs text-stone-400">
                {s.state === 'done' && (s.count ?? 0)}
                {s.state === 'failed' && 'alınmadı'}
              </span>
            </li>
          ))}
        </ul>

        {failed && (
          <div className="mt-6">
            <p className="text-sm text-stone-600">
              Bəzi məlumatlar yüklənmədi. İnternet bağlantısını yoxlayın.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setAttempt(a => a + 1)}
                className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors"
              >
                Yenidən cəhd et
              </button>
              {/* A till with its menu and its room is worth opening even if the
                  shift or the ready-marks did not arrive. The refresh will pick
                  up the rest on its own once the line is back. */}
              <button
                onClick={onDone}
                className="px-4 py-2.5 rounded-xl border border-stone-300 text-stone-600 text-sm font-medium hover:bg-stone-100 transition-colors"
              >
                Davam et
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';
// The superadmin's nightly report: what the health check found in each
// restaurant, night by night (05:00 Baku), plus a button to check now.

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { fetchHealthReportsOrNull, runHealthReport } from '@/lib/store';
import { byCompany, type HealthReport } from '@/lib/health-report';
import { formatDateTime } from '@/lib/dates';

function bakuTime(iso: string): string {
  return formatDateTime(iso, 'Asia/Baku');
}

export default function HealthReportPanel() {
  // null while loading or after a failed read: never shown as "all good".
  const [reports, setReports] = useState<HealthReport[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');

  async function load() {
    const r = await fetchHealthReportsOrNull();
    if (r) { setReports(r); setFailed(false); } else setFailed(true);
  }

  useEffect(() => { load(); }, []);

  async function runNow() {
    setRunning(true);
    setRunError('');
    const { error } = await runHealthReport();
    if (error) setRunError('Yoxlamaq alınmadı: ' + error);
    await load();
    setRunning(false);
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-5 gap-3">
        <p className="text-sm text-gray-400">Hər gecə 05:00 (Bakı) bütün restoranlar yoxlanılır</p>
        <button
          onClick={runNow}
          disabled={running}
          className="flex items-center gap-2 bg-[#2779a7] hover:bg-[#21678e] disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} /> İndi yoxla
        </button>
      </div>

      {runError && <p className="text-sm text-red-500 mb-4">{runError}</p>}

      {failed && !reports ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-sm text-red-500 mb-3">Hesabat yüklənmədi</p>
          <button onClick={load} className="text-sm text-[#2779a7] underline">Yenidən cəhd et</button>
        </div>
      ) : !reports ? (
        <div className="flex justify-center py-24">
          <span className="w-8 h-8 border-2 border-gray-200 border-t-[#2779a7] rounded-full animate-spin" />
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-16 text-center">
          <p className="text-sm text-gray-400">Hələ hesabat yoxdur</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-1">
                {r.problems.length === 0
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <AlertTriangle className="w-4 h-4 text-amber-500" />}
                <span className="text-sm font-semibold text-gray-800">{bakuTime(r.runAt)}</span>
                <span className="text-xs text-gray-400">
                  {r.problems.length === 0 ? 'Hər şey qaydasındadır' : `${r.problems.length} problem`}
                </span>
              </div>
              {byCompany(r.problems).map(g => (
                <div key={g.company} className="mt-3">
                  <p className="text-sm font-medium text-gray-700">{g.company}</p>
                  <ul className="mt-1 text-sm text-gray-600 list-disc pl-5">
                    {g.lines.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Tickets this machine has already put on paper. A "printed" report that was
// lost on a blip left the job claimed; two minutes later the server handed it
// out again and the kitchen got the same ticket twice. Kept on disk, so a
// restart in between does not forget.
const PRINTED_KEY = 'pos.printedJobs';
const PRINTED_KEEP = 500;
function printedJobs(): string[] {
  try { return JSON.parse(localStorage.getItem(PRINTED_KEY) ?? '[]') as string[]; } catch { return []; }
}
export function wasPrinted(id: string): boolean {
  return printedJobs().includes(id);
}
export function markPrinted(id: string): void {
  try { localStorage.setItem(PRINTED_KEY, JSON.stringify([...printedJobs(), id].slice(-PRINTED_KEEP))); } catch { /* private window */ }
}

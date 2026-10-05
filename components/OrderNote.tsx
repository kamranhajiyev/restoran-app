import { noteLines } from '@/lib/order-note';

/** An order's note, one line each for Tel, Ünvan and Qeyd — as the ticket prints it. */
export default function OrderNote({ note, className }: { note: string; className?: string }) {
  return (
    <div className={className}>
      {noteLines(note).map((line, i) => <p key={i}>{line}</p>)}
    </div>
  );
}

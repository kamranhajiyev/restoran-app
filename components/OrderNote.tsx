import { noteLines } from '@/lib/order-note';

/**
 * An order's note, one line each for Tel, Ünvan and Qeyd — as the ticket prints it.
 * wrap-anywhere: a note typed with no spaces stretched the whole order list
 * sideways off the screen (Test Restoran, 2026-10-06); the ticket already cuts it.
 */
export default function OrderNote({ note, className }: { note: string; className?: string }) {
  return (
    <div className={`wrap-anywhere ${className ?? ''}`}>
      {noteLines(note).map((line, i) => <p key={i}>{line}</p>)}
    </div>
  );
}

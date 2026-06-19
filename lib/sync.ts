import { addOrder, updateOrderStatus } from "@/lib/store";
import { getAllQueued, dequeueOrder, incrementAttempts, queueSize } from "@/lib/offline-queue";

export type SyncResult = { synced: number; failed: number; stillQueued: number };

export async function flushOrderQueue(currentCompanyId: string | null): Promise<SyncResult> {
  const queue = await getAllQueued();
  if (queue.length === 0) return { synced: 0, failed: 0, stillQueued: 0 };

  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    if (item.companyId !== currentCompanyId) { failed++; continue; }

    await incrementAttempts(item.id);

    try {
      const error = await addOrder(item.order);

      if (error === null) {
        if (item.order.status === 'ödənilib') {
          await updateOrderStatus(
            item.order.id, 'ödənilib',
            item.order.cashAmount ?? 0,
            item.order.cardAmount ?? 0,
            item.order.changeAmount ?? 0,
            item.order.discountAmount,
            item.order.discountType as '%' | '₼' | undefined,
          );
        }
        await dequeueOrder(item.id);
        synced++;
        continue;
      }

      if (/duplicate key|unique constraint|already exists/i.test(error)) {
        if (item.order.status === 'ödənilib') {
          await updateOrderStatus(
            item.order.id, 'ödənilib',
            item.order.cashAmount ?? 0,
            item.order.cardAmount ?? 0,
            item.order.changeAmount ?? 0,
            item.order.discountAmount,
            item.order.discountType as '%' | '₼' | undefined,
          );
        }
        await dequeueOrder(item.id);
        synced++;
        continue;
      }

      if (/jwt|auth|policy|permission|rls|row.level|403|401/i.test(error)) {
        console.error("[sync] Permission error — dropping order:", item.id, error);
        await dequeueOrder(item.id);
        failed++;
        continue;
      }

      if (/fetch|network|failed to fetch|load failed|timeout|econnrefused/i.test(error)) {
        failed++;
        continue;
      }

      if (item.attempts >= 3) {
        console.error("[sync] Max attempts — dropping order:", item.id, error);
        await dequeueOrder(item.id);
        failed++;
      } else {
        failed++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/fetch|network|failed to fetch|load failed/i.test(msg)) {
        console.error("[sync] Unexpected error syncing order:", item.id, e);
        await dequeueOrder(item.id);
      }
      failed++;
    }
  }

  const stillQueued = await queueSize();
  return { synced, failed, stillQueued };
}

// Where a hall's tables go on screen.
//
// The admin places tables on its own board, in that board's pixels. The till
// used to draw them at those same pixels inside a smaller, fixed box, so a plan
// laid out on a wide admin screen ran off the till's edges and the seller had
// to scroll inside the map to find a table. The till now fits the whole plan
// into the room it has: the same picture as in admin, just scaled.

import type { RestaurantTable } from "@/types";

export interface Box { x: number; y: number; w: number; h: number }

/** Room left around the plan so a table never sits on the box's edge. */
export const PLAN_PAD = 12;

/** Tables without a saved spot, in rows of five — the same spot as in admin. */
export function autoPos(idx: number): { x: number; y: number } {
  return { x: 20 + (idx % 5) * 130, y: 20 + Math.floor(idx / 5) * 110 };
}

/**
 * A table's spot and size on the admin board. A round table without a saved
 * height is as tall as it is wide; one stretched in admin keeps its own height
 * and is drawn as a pill.
 */
export function tableBox(t: Pick<RestaurantTable, "x" | "y" | "w" | "h" | "shape">, idx: number): Box {
  const pos = autoPos(idx);
  const w = t.w ?? 100;
  return { x: t.x ?? pos.x, y: t.y ?? pos.y, w, h: t.h ?? (t.shape === "round" ? w : 70) };
}

/** Corner rounding: a round square is a circle, a round oblong a pill. */
export function tableRadius(shape: RestaurantTable["shape"], w: number, h: number): number {
  return shape === "round" ? Math.min(w, h) / 2 : Math.min(10, Math.min(w, h) / 4);
}

/** Double-click in admin, as in Poster: square ↔ round, size kept. */
export function toggleShape(shape: RestaurantTable["shape"], w: number, h: number): NonNullable<RestaurantTable["shape"]> {
  if (shape !== "round") return "round";
  return h > w ? "rect-v" : "rect";
}

/**
 * The name a table gets from one click on "Masa əlavə et", as in Poster: the
 * next number after the highest one in the restaurant (every hall, so two
 * halls don't both get a "5"). Renamed afterwards if the restaurant wants.
 */
export function nextTableName(names: string[]): string {
  const nums = names.map(n => parseInt(n.trim(), 10)).filter(n => Number.isFinite(n));
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

/** Where a copied table lands: just right of the original, same row. */
export function copySpot(b: Box): { x: number; y: number } {
  return { x: b.x + b.w + 20, y: b.y };
}

/**
 * A reload of the table list while admin is arranging the plan. Every save
 * makes the database announce a change and admin download the list again; a
 * download that left before the latest save arrived carries the old spot or
 * shape, and a table snapped back, then forward again once its own save came
 * round (2026-10-23). A table being dragged or still saving keeps what is on
 * screen; every other table takes the server's.
 */
export function keepLocalTables<T extends { id: number }>(server: T[], local: T[], busy: Set<number>): T[] {
  if (busy.size === 0) return server;
  const mine = new Map(local.filter(t => busy.has(t.id)).map(t => [t.id, t]));
  return server.map(t => mine.get(t.id) ?? t);
}

/** Smallest a table can be dragged down to: its name still has to fit. */
export const MIN_TABLE = 40;

/** The corner handle: drag by dx, dy from the size it started at. */
export function resizeTable(w: number, h: number, dx: number, dy: number): { w: number; h: number } {
  return { w: Math.max(MIN_TABLE, Math.round(w + dx)), h: Math.max(MIN_TABLE, Math.round(h + dy)) };
}

/**
 * How to draw `boxes` inside a `width` × `maxHeight` area, so the whole hall
 * shows at once: every table fits, the plan's empty top-left margin is dropped,
 * and it never grows past `maxScale` so three tables don't become three
 * billboards. Fitting the width alone ran a tall hall off the bottom of the
 * screen; fitting the height only works because the order-type cards above the
 * map shrink to a row once Masa is picked.
 */
export function fitPlan(boxes: Box[], width: number, maxHeight: number, maxScale = 1.5) {
  if (boxes.length === 0 || width <= 0) return { scale: 1, height: 200, place: (b: Box) => b };
  const minX = Math.min(...boxes.map(b => b.x));
  const minY = Math.min(...boxes.map(b => b.y));
  const planW = Math.max(...boxes.map(b => b.x + b.w)) - minX;
  const planH = Math.max(...boxes.map(b => b.y + b.h)) - minY;
  const roomW = Math.max(1, width - PLAN_PAD * 2);
  const roomH = Math.max(1, maxHeight - PLAN_PAD * 2);
  const scale = Math.min(roomW / planW, roomH / planH, maxScale);
  // Centred across, so a narrow plan doesn't hug the left on a wide screen.
  const left = PLAN_PAD + (roomW - planW * scale) / 2;
  return {
    scale,
    height: Math.ceil(planH * scale + PLAN_PAD * 2),
    place: (b: Box): Box => ({
      x: left + (b.x - minX) * scale,
      y: PLAN_PAD + (b.y - minY) * scale,
      w: b.w * scale,
      h: b.h * scale,
    }),
  };
}

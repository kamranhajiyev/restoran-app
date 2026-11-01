// A balance is a sum over every row, and one read returns at most 1000: a
// short list would be a wrong balance with nothing to say so. İXLAS CAFE had 819
// paid courier orders after its first month (2026-11-01), so courier debts read
// in one go would have started dropping deliveries within days.
//
// `page` must order by something unique (end on .order('id')), or rows can
// repeat or go missing between pages. Null when any page fails.
export async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error || !data) return null;
    out.push(...data);
    if (data.length < size) return out;
  }
}

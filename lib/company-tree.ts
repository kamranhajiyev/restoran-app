// Superadmin's company list: each branch right under its main məkan
// (20261104_company_groups.sql). A branch whose main məkan is not in the list
// (trashed) stands on its own rather than vanishing.
export function withBranches<T extends { id: string; parentId: string | null }>(companies: T[]): { company: T; branch: boolean }[] {
  const ids = new Set(companies.map(c => c.id));
  const isBranch = (c: T) => !!c.parentId && ids.has(c.parentId);
  return companies.filter(c => !isBranch(c)).flatMap(c => [
    { company: c, branch: false },
    ...companies.filter(b => isBranch(b) && b.parentId === c.id).map(b => ({ company: b, branch: true })),
  ]);
}

// The till's dial tone.
//
// Answers nothing and touches no database on purpose. Kept for exes and APKs
// built before 2026-10-24, which still ask it; newer tills ask the plain file
// public/api/health.txt, which costs no function call (lib/offline-net.ts).
// Never cached — a cached 200 would tell a disconnected till it is fine.

export const dynamic = "force-dynamic";

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

// The till's dial tone.
//
// Answers nothing and touches no database on purpose: the seller screen HEADs
// this every few seconds to decide whether it is online, and that check must
// stay cheap enough to run all service long. Never cached — a cached 200 would
// tell a disconnected till it is fine.

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

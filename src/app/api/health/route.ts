import { version as pkgVersion } from "../../../../package.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    name: "symphonia",
    version: pkgVersion,
  });
}

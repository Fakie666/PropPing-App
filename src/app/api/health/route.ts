import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json(
      {
        status: "ok",
        service: "PropPing",
        timestamp: new Date().toISOString()
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return Response.json(
      {
        status: "error",
        service: "PropPing",
        timestamp: new Date().toISOString(),
        error: message
      },
      { status: 503 }
    );
  }
}

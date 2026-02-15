import { clearUserSession } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  await clearUserSession();
  return NextResponse.redirect(new URL("/login", request.url));
}

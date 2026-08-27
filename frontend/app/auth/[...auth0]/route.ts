import { auth0 } from "@/lib/auth0";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return await auth0.middleware(request);
}

export async function POST(request: NextRequest) {
  return await auth0.middleware(request);
}

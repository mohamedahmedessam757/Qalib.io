import { NextResponse } from "next/server";
import { requireUser } from "@/lib/db";
import { getOpenRouterConfig } from "@/lib/ai/openrouter";

export async function GET() {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { apiKey, model } = getOpenRouterConfig();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "AI is not configured" },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, model });
}

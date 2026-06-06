import { NextResponse } from "next/server";
import { sendHazardReportEmail } from "@/lib/camera/hazard-agent";
import type { HazardReportSendRequest } from "@/lib/camera/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HazardReportSendRequest;

    if (!body.email?.to?.trim()) {
      return NextResponse.json({ error: "Recipient email (to) is required" }, { status: 400 });
    }
    if (!body.email.subject?.trim() || !body.email.body?.trim()) {
      return NextResponse.json({ error: "Email subject and body are required" }, { status: 400 });
    }
    if (!body.analysis) {
      return NextResponse.json({ error: "analysis is required" }, { status: 400 });
    }

    const { sent, status } = await sendHazardReportEmail(body.email, body.analysis);

    return NextResponse.json({
      emailSent: sent,
      emailStatus: status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send report email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

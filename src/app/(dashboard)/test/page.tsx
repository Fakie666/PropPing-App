import { MessageDirection } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { sendSms } from "@/lib/twilio-client";

type TestSmsPageProps = {
  searchParams?: {
    ok?: string;
    error?: string;
  };
};

function normalizePhone(value: string): string {
  return value.replace(/\s+/g, "");
}

function isLikelyE164(value: string): boolean {
  return /^\+\d{10,15}$/.test(value);
}

async function sendTestSmsAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireUser();
  const toPhone = normalizePhone(String(formData.get("toPhone") ?? "").trim());
  const bodyInput = String(formData.get("body") ?? "").trim();

  if (!toPhone || !bodyInput) {
    redirect("/test?error=missing_fields");
  }

  if (!isLikelyE164(toPhone)) {
    redirect("/test?error=invalid_phone");
  }

  if (bodyInput.length > 500) {
    redirect("/test?error=message_too_long");
  }

  const body = bodyInput.startsWith("[TEST]") ? bodyInput : `[TEST] ${bodyInput}`;

  try {
    const result = await sendSms({
      from: user.tenant.twilioPhoneNumber,
      to: toPhone,
      body
    });

    await db.message.create({
      data: {
        tenantId: user.tenantId,
        direction: MessageDirection.OUTBOUND,
        fromPhone: user.tenant.twilioPhoneNumber,
        toPhone,
        body,
        twilioMessageSid: result.sid
      }
    });
  } catch {
    redirect("/test?error=send_failed");
  }

  redirect("/test?ok=1");
}

export default async function TestSmsPage({ searchParams }: TestSmsPageProps) {
  const user = await requireUser();
  const recentTests = await db.message.findMany({
    where: {
      tenantId: user.tenantId,
      direction: MessageDirection.OUTBOUND,
      body: {
        startsWith: "[TEST]"
      }
    },
    orderBy: { createdAt: "desc" },
    take: 20
  });

  const feedback = searchParams?.ok
    ? "Test SMS sent successfully."
    : searchParams?.error === "missing_fields"
      ? "Please provide phone number and message."
      : searchParams?.error === "invalid_phone"
        ? "Phone number must be in international format (for example +447700900000)."
        : searchParams?.error === "message_too_long"
          ? "Message is too long. Keep it under 500 characters."
          : searchParams?.error === "send_failed"
            ? "Failed to send test SMS. Check Twilio config and try again."
            : null;

  return (
    <section className="panel">
      <div className="header-row">
        <div>
          <h2>Test SMS</h2>
          <p className="muted">Send operational test messages from your tenant number. Current tenant: {user.tenant.name}.</p>
        </div>
      </div>

      {feedback ? <p className="muted">{feedback}</p> : null}

      <form className="grid" action={sendTestSmsAction}>
        <label>
          Phone number
          <input name="toPhone" placeholder="+447700900000" required />
        </label>
        <label>
          Message
          <textarea name="body" placeholder="Test message body" rows={4} maxLength={500} required />
        </label>
        <button type="submit">Send Test SMS</button>
      </form>

      <h3>Recent Test Messages</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sent At</th>
              <th>To</th>
              <th>Body</th>
              <th>Message SID</th>
            </tr>
          </thead>
          <tbody>
            {recentTests.map((message) => (
              <tr key={message.id}>
                <td>{formatDateTime(message.createdAt, user.tenant.timezone)}</td>
                <td>{message.toPhone}</td>
                <td>{message.body}</td>
                <td>{message.twilioMessageSid ?? "-"}</td>
              </tr>
            ))}
            {recentTests.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No test messages sent yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

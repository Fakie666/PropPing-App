import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { type Prisma } from "@prisma/client";
import { parseCompliancePolicy, scheduleComplianceReminderJobsForTenant } from "@/lib/compliance";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isLoopbackBaseUrl, normalizeBaseUrl } from "@/lib/webhook-url";

type SettingsPageProps = {
  searchParams?: {
    saved?: string;
    templates?: string;
    policy?: string;
    error?: string;
  };
};

function parseCommaList(input: string): string[] {
  return input
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function parseNumberList(input: string): number[] {
  return input
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.floor(v));
}

async function updateTenantSettingsAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireUser();
  const forwardToPhoneNumber = String(formData.get("forwardToPhoneNumber") ?? "").trim();
  const ownerNotificationPhoneNumber = String(formData.get("ownerNotificationPhoneNumber") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim() || "Europe/London";
  const bookingUrlViewings = String(formData.get("bookingUrlViewings") ?? "").trim();
  const bookingUrlCalls = String(formData.get("bookingUrlCalls") ?? "").trim();
  const allowedPostcodePrefixesRaw = String(formData.get("allowedPostcodePrefixes") ?? "").trim();

  if (!forwardToPhoneNumber || !ownerNotificationPhoneNumber) {
    redirect("/settings?error=missing_settings_fields");
  }

  await db.tenant.update({
    where: { id: user.tenantId },
    data: {
      forwardToPhoneNumber,
      ownerNotificationPhoneNumber,
      timezone,
      bookingUrlViewings: bookingUrlViewings || null,
      bookingUrlCalls: bookingUrlCalls || null,
      allowedPostcodePrefixes: parseCommaList(allowedPostcodePrefixesRaw)
    }
  });

  redirect("/settings?saved=1");
}

async function updateTemplatesAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireUser();
  const templatesText = String(formData.get("templatesJson") ?? "").trim();

  let parsed: Prisma.InputJsonValue = {};
  if (templatesText) {
    try {
      const value = JSON.parse(templatesText);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Templates JSON must be an object.");
      }
      parsed = value as Prisma.InputJsonValue;
    } catch {
      redirect("/settings?error=invalid_templates_json");
    }
  }

  await db.tenant.update({
    where: { id: user.tenantId },
    data: {
      messageTemplatesJson: parsed
    }
  });

  redirect("/settings?templates=1");
}

async function updateCompliancePolicyAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireUser();
  const dueSoonDaysRaw = String(formData.get("dueSoonDays") ?? "").trim();
  const overdueReminderDaysRaw = String(formData.get("overdueReminderDays") ?? "").trim();

  const dueSoonDays = parseNumberList(dueSoonDaysRaw);
  const overdueReminderDays = Number(overdueReminderDaysRaw);

  if (dueSoonDays.length === 0 || !Number.isFinite(overdueReminderDays) || overdueReminderDays <= 0) {
    redirect("/settings?error=invalid_compliance_policy");
  }

  await db.tenant.update({
    where: { id: user.tenantId },
    data: {
      compliancePolicyJson: {
        dueSoonDays,
        overdueReminderDays: Math.floor(overdueReminderDays)
      } as Prisma.InputJsonValue
    }
  });

  await scheduleComplianceReminderJobsForTenant(user.tenantId);
  redirect("/settings?policy=1");
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const user = await requireUser();
  const tenant = await db.tenant.findUnique({
    where: { id: user.tenantId }
  });

  if (!tenant) {
    redirect("/login");
  }

  const policy = parseCompliancePolicy(tenant.compliancePolicyJson);
  const configuredBaseUrl = normalizeBaseUrl(process.env.TWILIO_WEBHOOK_BASE_URL) || normalizeBaseUrl(process.env.APP_BASE_URL);
  const requestHeaders = headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.trim();
  const host = forwardedHost || requestHeaders.get("host")?.trim();
  const proto = requestHeaders.get("x-forwarded-proto")?.trim() || "https";
  const requestBaseUrl = host ? `${proto}://${host}` : null;
  const baseUrl =
    configuredBaseUrl && !(isLoopbackBaseUrl(configuredBaseUrl) && requestBaseUrl && !isLoopbackBaseUrl(requestBaseUrl))
      ? configuredBaseUrl
      : normalizeBaseUrl(requestBaseUrl) || configuredBaseUrl || "";
  const feedback = searchParams?.error
    ? "Settings update failed. Please check your input."
    : searchParams?.saved
      ? "Tenant settings updated."
      : searchParams?.templates
        ? "Templates updated."
        : searchParams?.policy
          ? "Compliance policy updated and reminder schedules refreshed."
          : null;

  return (
    <section className="panel">
      <div className="header-row">
        <div>
          <h2>Tenant Settings</h2>
          <p className="muted">Update telephony, templates, and compliance policy.</p>
        </div>
      </div>

      {feedback ? <p className="muted">{feedback}</p> : null}

      <section className="panel">
        <h3>Webhook Endpoints</h3>
        {baseUrl ? (
          <div className="grid">
            <label>
              Voice Incoming URL
              <input value={`${baseUrl}/api/twilio/voice/incoming`} readOnly />
            </label>
            <label>
              Voice Dial Status URL
              <input value={`${baseUrl}/api/twilio/voice/dial-status`} readOnly />
            </label>
            <label>
              SMS Incoming URL
              <input value={`${baseUrl}/api/twilio/sms/incoming`} readOnly />
            </label>
          </div>
        ) : (
          <p className="muted">
            Set `TWILIO_WEBHOOK_BASE_URL` (or `APP_BASE_URL`) in environment variables to generate exact Twilio webhook
            URLs.
          </p>
        )}
      </section>

      <div className="cards">
        <section className="panel">
          <h3>Telephony & Routing</h3>
          <form className="grid" action={updateTenantSettingsAction}>
            <label>
              Forward To Phone Number
              <input name="forwardToPhoneNumber" defaultValue={tenant.forwardToPhoneNumber} required />
            </label>
            <label>
              Owner Notification Phone Number
              <input
                name="ownerNotificationPhoneNumber"
                defaultValue={tenant.ownerNotificationPhoneNumber}
                required
              />
            </label>
            <label>
              Timezone
              <input name="timezone" defaultValue={tenant.timezone} required />
            </label>
            <label>
              Allowed Postcode Prefixes (comma-separated)
              <input name="allowedPostcodePrefixes" defaultValue={tenant.allowedPostcodePrefixes.join(",")} />
            </label>
            <label>
              Viewing Booking URL
              <input name="bookingUrlViewings" defaultValue={tenant.bookingUrlViewings ?? ""} />
            </label>
            <label>
              Calls Booking URL
              <input name="bookingUrlCalls" defaultValue={tenant.bookingUrlCalls ?? ""} />
            </label>
            <button type="submit">Save Tenant Settings</button>
          </form>
        </section>

        <section className="panel">
          <h3>Compliance Policy</h3>
          <form className="grid" action={updateCompliancePolicyAction}>
            <label>
              Due Soon Days (comma-separated)
              <input name="dueSoonDays" defaultValue={policy.dueSoonDays.join(",")} required />
            </label>
            <label>
              Overdue Reminder Frequency (days)
              <input name="overdueReminderDays" type="number" min={1} defaultValue={policy.overdueReminderDays} required />
            </label>
            <button type="submit">Save Compliance Policy</button>
          </form>
        </section>
      </div>

      <section className="panel">
        <h3>Message Templates JSON</h3>
        <p className="muted">Provide valid JSON object with template key/value pairs.</p>
        <form className="grid" action={updateTemplatesAction}>
          <label>
            Templates JSON
            <textarea
              name="templatesJson"
              rows={14}
              defaultValue={JSON.stringify(tenant.messageTemplatesJson ?? {}, null, 2)}
            />
          </label>
          <button type="submit">Save Templates</button>
        </form>
      </section>
    </section>
  );
}

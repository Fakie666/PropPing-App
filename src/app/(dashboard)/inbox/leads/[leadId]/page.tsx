import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/time";
import { LeadStatus } from "@prisma/client";
import { notFound, redirect } from "next/navigation";

type LeadDetailPageProps = {
  params: {
    leadId: string;
  };
  searchParams?: {
    resumed?: string;
    error?: string;
  };
};

async function resumeLeadAutomationAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireUser();
  const leadId = String(formData.get("leadId") ?? "");

  if (!leadId) {
    redirect("/inbox/leads?error=invalid_lead");
  }

  await db.lead.updateMany({
    where: {
      id: leadId,
      tenantId: user.tenantId,
      status: LeadStatus.NEEDS_HUMAN
    },
    data: {
      status: LeadStatus.OPEN
    }
  });

  redirect(`/inbox/leads/${leadId}?resumed=1`);
}

export default async function LeadDetailPage({ params, searchParams }: LeadDetailPageProps) {
  const user = await requireUser();

  const lead = await db.lead.findFirst({
    where: {
      id: params.leadId,
      tenantId: user.tenantId
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!lead) {
    notFound();
  }

  const feedback = searchParams?.resumed
    ? "Automation resumed. New inbound messages will continue this flow."
    : searchParams?.error
      ? "Action failed. Please retry."
      : null;

  return (
    <section className="panel">
      <div className="header-row">
        <div>
          <h2>Lead Detail</h2>
          <p className="muted">Lead ID: {lead.id}</p>
        </div>
        <span className="badge">{lead.status}</span>
      </div>

      {feedback ? <p className="muted">{feedback}</p> : null}

      {lead.status === LeadStatus.NEEDS_HUMAN ? (
        <section className="panel">
          <h3>Human Handoff</h3>
          <p className="muted">
            Automation is currently paused for this lead. Resume only when an agent has handled the escalation.
          </p>
          <form action={resumeLeadAutomationAction}>
            <input type="hidden" name="leadId" value={lead.id} />
            <button type="submit">Resume Automation</button>
          </form>
        </section>
      ) : null}

      <div className="cards">
        <div className="panel">
          <h3>Overview</h3>
          <p>
            <strong>Caller:</strong> {lead.callerPhone}
          </p>
          <p>
            <strong>Name:</strong> {lead.name ?? "-"}
          </p>
          <p>
            <strong>Intent:</strong> {lead.intent}
          </p>
          <p>
            <strong>Step:</strong> {lead.flowStep}
          </p>
        </div>
        <div className="panel">
          <h3>Requirements</h3>
          <p>
            <strong>Area:</strong> {lead.desiredArea ?? "-"}
          </p>
          <p>
            <strong>Postcode:</strong> {lead.postcode ?? "-"}
          </p>
          <p>
            <strong>Property query:</strong> {lead.propertyQuery ?? "-"}
          </p>
          <p>
            <strong>Notes:</strong> {lead.requirements ?? lead.notes ?? "-"}
          </p>
        </div>
      </div>

      <h3>Message Timeline</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Direction</th>
              <th>Body</th>
            </tr>
          </thead>
          <tbody>
            {lead.messages.map((message) => (
              <tr key={message.id}>
                <td>{formatDateTime(message.createdAt, user.tenant.timezone)}</td>
                <td>{message.direction}</td>
                <td>{message.body}</td>
              </tr>
            ))}
            {lead.messages.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No messages logged for this lead yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

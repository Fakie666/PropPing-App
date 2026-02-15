import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/time";
import { MaintenanceStatus } from "@prisma/client";
import { notFound, redirect } from "next/navigation";

type MaintenanceDetailPageProps = {
  params: {
    requestId: string;
  };
  searchParams?: {
    resumed?: string;
    error?: string;
  };
};

async function resumeMaintenanceAutomationAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireUser();
  const requestId = String(formData.get("requestId") ?? "");
  const resumeStatus = String(formData.get("resumeStatus") ?? "");

  if (!requestId || (resumeStatus !== MaintenanceStatus.OPEN && resumeStatus !== MaintenanceStatus.LOGGED)) {
    redirect("/inbox/maintenance?error=invalid_request");
  }

  await db.maintenanceRequest.updateMany({
    where: {
      id: requestId,
      tenantId: user.tenantId,
      status: MaintenanceStatus.NEEDS_HUMAN
    },
    data: {
      status: resumeStatus as MaintenanceStatus,
      needsHuman: false
    }
  });

  redirect(`/inbox/maintenance/${requestId}?resumed=1`);
}

export default async function MaintenanceDetailPage({ params, searchParams }: MaintenanceDetailPageProps) {
  const user = await requireUser();

  const request = await db.maintenanceRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: user.tenantId
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!request) {
    notFound();
  }

  const resumeStatus = request.flowStep >= 5 ? MaintenanceStatus.LOGGED : MaintenanceStatus.OPEN;
  const feedback = searchParams?.resumed
    ? "Automation resumed. New inbound messages will continue this flow."
    : searchParams?.error
      ? "Action failed. Please retry."
      : null;

  return (
    <section className="panel">
      <div className="header-row">
        <div>
          <h2>Maintenance Detail</h2>
          <p className="muted">Request ID: {request.id}</p>
        </div>
        <span className="badge">{request.status}</span>
      </div>

      {feedback ? <p className="muted">{feedback}</p> : null}

      {request.status === MaintenanceStatus.NEEDS_HUMAN ? (
        <section className="panel">
          <h3>Human Handoff</h3>
          <p className="muted">
            Automation is paused for this request. Resume only after an agent has completed manual escalation handling.
          </p>
          <form action={resumeMaintenanceAutomationAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="resumeStatus" value={resumeStatus} />
            <button type="submit">Resume Automation</button>
          </form>
        </section>
      ) : null}

      <div className="cards">
        <div className="panel">
          <h3>Overview</h3>
          <p>
            <strong>Caller:</strong> {request.callerPhone}
          </p>
          <p>
            <strong>Name:</strong> {request.name ?? "-"}
          </p>
          <p>
            <strong>Severity:</strong> {request.severity ?? "-"}
          </p>
          <p>
            <strong>Step:</strong> {request.flowStep}
          </p>
        </div>
        <div className="panel">
          <h3>Issue</h3>
          <p>
            <strong>Address:</strong> {request.propertyAddress ?? "-"}
          </p>
          <p>
            <strong>Postcode:</strong> {request.postcode ?? "-"}
          </p>
          <p>
            <strong>Description:</strong> {request.issueDescription ?? "-"}
          </p>
          <p>
            <strong>Notes:</strong> {request.notes ?? "-"}
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
            {request.messages.map((message) => (
              <tr key={message.id}>
                <td>{formatDateTime(message.createdAt, user.tenant.timezone)}</td>
                <td>{message.direction}</td>
                <td>{message.body}</td>
              </tr>
            ))}
            {request.messages.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No messages logged for this maintenance request yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

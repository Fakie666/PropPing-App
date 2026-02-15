import Link from "next/link";
import { ComplianceStatus, LeadStatus, MaintenanceStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";

type RowTone = "new" | "hot" | "urgent" | "overdue" | "human";

type TriageRow = {
  id: string;
  href: string;
  name: string;
  phone: string;
  note: string;
  tone: RowTone;
  statusLabel: string;
  updatedAt: Date;
};

function summarize(value: string | null | undefined, fallback: string, max = 95) {
  const source = (value ?? "").replace(/\s+/g, " ").trim();
  if (!source) {
    return fallback;
  }
  if (source.length <= max) {
    return source;
  }
  return `${source.slice(0, max - 3)}...`;
}

function timeAgo(timestamp: Date) {
  const diffMs = Math.max(0, Date.now() - timestamp.getTime());
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) {
    return "Just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
}

function toneToStatusClass(tone: RowTone) {
  switch (tone) {
    case "hot":
      return "status-hot";
    case "urgent":
      return "status-urgent";
    case "overdue":
      return "status-overdue";
    case "human":
      return "status-human";
    default:
      return "status-new";
  }
}

export default async function DashboardPage() {
  const user = await requireUser();
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    openLeads,
    qualifiedLast24h,
    scheduledLast24h,
    openMaintenance,
    urgentMaintenance,
    needsHumanLeads,
    needsHumanMaintenance,
    overdueDocs,
    missingDocs,
    pendingJobs,
    leadRows,
    maintenanceRows
  ] = await Promise.all([
    db.lead.count({
      where: {
        tenantId: user.tenantId,
        status: {
          in: [LeadStatus.OPEN, LeadStatus.QUALIFIED]
        }
      }
    }),
    db.lead.count({
      where: {
        tenantId: user.tenantId,
        status: LeadStatus.QUALIFIED,
        updatedAt: { gte: last24h }
      }
    }),
    db.lead.count({
      where: {
        tenantId: user.tenantId,
        status: LeadStatus.SCHEDULED,
        updatedAt: { gte: last24h }
      }
    }),
    db.maintenanceRequest.count({
      where: {
        tenantId: user.tenantId,
        status: {
          in: [MaintenanceStatus.OPEN, MaintenanceStatus.LOGGED, MaintenanceStatus.IN_PROGRESS]
        }
      }
    }),
    db.maintenanceRequest.count({
      where: {
        tenantId: user.tenantId,
        status: {
          in: [MaintenanceStatus.OPEN, MaintenanceStatus.LOGGED, MaintenanceStatus.IN_PROGRESS]
        },
        severity: {
          in: ["URGENT", "EMERGENCY"]
        }
      }
    }),
    db.lead.count({
      where: {
        tenantId: user.tenantId,
        status: LeadStatus.NEEDS_HUMAN
      }
    }),
    db.maintenanceRequest.count({
      where: {
        tenantId: user.tenantId,
        status: MaintenanceStatus.NEEDS_HUMAN
      }
    }),
    db.complianceDocument.count({
      where: {
        tenantId: user.tenantId,
        status: ComplianceStatus.OVERDUE
      }
    }),
    db.complianceDocument.count({
      where: {
        tenantId: user.tenantId,
        status: ComplianceStatus.MISSING
      }
    }),
    db.job.count({
      where: {
        tenantId: user.tenantId,
        status: "PENDING"
      }
    }),
    db.lead.findMany({
      where: {
        tenantId: user.tenantId,
        status: {
          in: [LeadStatus.OPEN, LeadStatus.QUALIFIED, LeadStatus.NEEDS_HUMAN]
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 8
    }),
    db.maintenanceRequest.findMany({
      where: {
        tenantId: user.tenantId,
        status: {
          in: [MaintenanceStatus.OPEN, MaintenanceStatus.LOGGED, MaintenanceStatus.IN_PROGRESS, MaintenanceStatus.NEEDS_HUMAN]
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 8
    })
  ]);

  const triageRows: TriageRow[] = [
    ...leadRows.map((lead) => {
      let tone: RowTone = "new";
      let statusLabel = "New";
      if (lead.status === LeadStatus.QUALIFIED) {
        tone = "hot";
        statusLabel = "Hot Lead";
      } else if (lead.status === LeadStatus.NEEDS_HUMAN) {
        tone = "human";
        statusLabel = "Needs Human";
      }

      return {
        id: `lead_${lead.id}`,
        href: `/inbox/leads/${lead.id}`,
        name: lead.name ?? "Unnamed lead",
        phone: lead.callerPhone,
        note: summarize(
          lead.requirements,
          lead.desiredArea
            ? `Viewing request in ${lead.desiredArea}.`
            : "Caller is waiting for viewing support."
        ),
        tone,
        statusLabel,
        updatedAt: lead.updatedAt
      };
    }),
    ...maintenanceRows.map((request) => {
      let tone: RowTone = "new";
      let statusLabel = "New";
      if (request.severity === "URGENT" || request.severity === "EMERGENCY") {
        tone = "urgent";
        statusLabel = request.severity;
      } else if (request.status === MaintenanceStatus.NEEDS_HUMAN) {
        tone = "human";
        statusLabel = "Needs Human";
      } else if (request.status === MaintenanceStatus.IN_PROGRESS) {
        tone = "overdue";
        statusLabel = "In Progress";
      }

      return {
        id: `maint_${request.id}`,
        href: `/inbox/maintenance/${request.id}`,
        name: request.name ?? "Maintenance caller",
        phone: request.callerPhone,
        note: summarize(
          request.issueDescription,
          request.propertyAddress
            ? `Issue reported at ${request.propertyAddress}.`
            : "Tenant has reported a maintenance issue."
        ),
        tone,
        statusLabel,
        updatedAt: request.updatedAt
      };
    })
  ]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 7);

  const highlighted = triageRows[0];
  const humanHandoffCount = needsHumanLeads + needsHumanMaintenance;
  const urgentReminderCount = urgentMaintenance + overdueDocs + missingDocs;
  const openTaskCount = openLeads + openMaintenance + pendingJobs;

  const twilioReady = Boolean(process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim());
  const openAiReady = Boolean(process.env.OPENAI_API_KEY?.trim());
  const webhookBaseConfigured = Boolean(process.env.TWILIO_WEBHOOK_BASE_URL?.trim());

  return (
    <section className="stack">
      <section className="triage-scene">
        <article className="panel triage-summary-card">
          <div className="summary-head">
            <p className="tiny-title">Lead Summary</p>
            <span className="tiny-dots" aria-hidden>
              ...
            </span>
          </div>

          {highlighted ? (
            <>
              <div className="summary-profile">
                <h3>{highlighted.name}</h3>
                <p className="muted">{highlighted.phone}</p>
                <span className={`triage-status ${toneToStatusClass(highlighted.tone)}`}>{highlighted.statusLabel}</span>
              </div>
              <p className="summary-note">{highlighted.note}</p>
              <div className="summary-waits">
                <p>
                  Waiting <strong>{Math.max(1, triageRows.length)}</strong>
                </p>
                <p>
                  Waiting for <strong>{timeAgo(highlighted.updatedAt)}</strong>
                </p>
              </div>
              <div className="summary-actions">
                <Link className="action-link summary-call" href={highlighted.href}>
                  Open Conversation
                </Link>
                <Link className="action-link summary-book" href="/inbox/leads">
                  Book Viewing
                </Link>
              </div>
            </>
          ) : (
            <p className="muted">No open conversations yet. New inbound calls and SMS triage will appear here.</p>
          )}
        </article>

        <article className="panel triage-main-board">
          <div className="triage-top">
            <div>
              <h2>Tenant Triage</h2>
              <p className="muted">
                Live view for <strong>{user.tenant.name}</strong> conversations and callback queue.
              </p>
            </div>
            <div className="triage-top-actions">
              <span className="search-pill">Tags</span>
              <span className="notif-pill">{humanHandoffCount}</span>
              <Link className="action-link" href="/test">
                Log Call
              </Link>
            </div>
          </div>

          <div className="triage-kpi-strip">
            <div>
              <p className="metric-value">{openLeads}</p>
              <p className="metric-label">Callbacks Needed</p>
            </div>
            <div>
              <p className="metric-value warn">{urgentReminderCount}</p>
              <p className="metric-label">Urgent Reminders</p>
            </div>
            <div>
              <p className="metric-value info">{openTaskCount}</p>
              <p className="metric-label">Open Tasks</p>
            </div>
          </div>

          <div className="triage-tabs">
            <span className="active">Callbacks ({openLeads})</span>
            <span>Reminders</span>
            <span>Tasks</span>
            <span>All</span>
          </div>

          <div className="triage-list">
            {triageRows.map((row) => (
              <Link key={row.id} href={row.href} className="triage-row">
                <div className="triage-avatar">{row.name.slice(0, 1).toUpperCase()}</div>
                <div className="triage-row-body">
                  <div className="triage-row-head">
                    <p className="triage-name">{row.name}</p>
                    <span className={`triage-status ${toneToStatusClass(row.tone)}`}>{row.statusLabel}</span>
                  </div>
                  <p className="triage-phone">{row.phone}</p>
                  <p className="triage-note">{row.note}</p>
                </div>
                <div className="triage-age">{timeAgo(row.updatedAt)}</div>
              </Link>
            ))}
            {triageRows.length === 0 ? <p className="muted">No active callback items right now.</p> : null}
          </div>
        </article>
      </section>

      <section className="cards">
        <article className="panel">
          <h3>Ops Snapshot</h3>
          <div className="stack-sm">
            <p className="status-line">
              <span className="status-dot ok" />
              Qualified (24h): {qualifiedLast24h}
            </p>
            <p className="status-line">
              <span className="status-dot ok" />
              Scheduled viewings (24h): {scheduledLast24h}
            </p>
            <p className="status-line">
              <span className="status-dot warn" />
              Urgent maintenance: {urgentMaintenance}
            </p>
            <p className="status-line">
              <span className="status-dot danger" />
              Compliance risk items: {overdueDocs + missingDocs}
            </p>
          </div>
        </article>

        <article className="panel">
          <h3>Platform Readiness</h3>
          <div className="stack-sm">
            <p className="status-line">
              <span className={twilioReady ? "status-dot ok" : "status-dot danger"} />
              Twilio credentials: {twilioReady ? "Configured" : "Missing"}
            </p>
            <p className="status-line">
              <span className={webhookBaseConfigured ? "status-dot ok" : "status-dot warn"} />
              Webhook base URL: {webhookBaseConfigured ? "Configured" : "Missing"}
            </p>
            <p className="status-line">
              <span className={openAiReady ? "status-dot ok" : "status-dot warn"} />
              OpenAI extraction: {openAiReady ? "Configured" : "Fallback mode only"}
            </p>
            <p className="muted tiny">Last refresh: {formatDateTime(new Date(), user.tenant.timezone)}</p>
          </div>
        </article>
      </section>
    </section>
  );
}

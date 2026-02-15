import Link from "next/link";
import { MaintenanceStatus, Prisma, Severity } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/time";

type MaintenanceInboxPageProps = {
  searchParams?: {
    q?: string | string[];
    status?: string | string[];
    severity?: string | string[];
  };
};

const STATUS_OPTIONS = [
  MaintenanceStatus.OPEN,
  MaintenanceStatus.LOGGED,
  MaintenanceStatus.IN_PROGRESS,
  MaintenanceStatus.NEEDS_HUMAN,
  MaintenanceStatus.CLOSED,
  MaintenanceStatus.OUT_OF_AREA,
  MaintenanceStatus.OPTED_OUT
];

const SEVERITY_OPTIONS = [Severity.ROUTINE, Severity.URGENT, Severity.EMERGENCY];

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function isMaintenanceStatus(value: string): value is MaintenanceStatus {
  return STATUS_OPTIONS.includes(value as MaintenanceStatus);
}

function isSeverity(value: string): value is Severity {
  return SEVERITY_OPTIONS.includes(value as Severity);
}

export default async function MaintenanceInboxPage({ searchParams }: MaintenanceInboxPageProps) {
  const user = await requireUser();
  const q = firstValue(searchParams?.q).trim();
  const statusRaw = firstValue(searchParams?.status).trim();
  const severityRaw = firstValue(searchParams?.severity).trim();

  const status = isMaintenanceStatus(statusRaw) ? statusRaw : "";
  const severity = isSeverity(severityRaw) ? severityRaw : "";

  const where: Prisma.MaintenanceRequestWhereInput = {
    tenantId: user.tenantId
  };

  if (status) {
    where.status = status;
  }

  if (severity) {
    where.severity = severity;
  }

  if (q) {
    where.OR = [
      { callerPhone: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { postcode: { contains: q, mode: "insensitive" } },
      { propertyAddress: { contains: q, mode: "insensitive" } },
      { issueDescription: { contains: q, mode: "insensitive" } }
    ];
  }

  const [requests, openCount, urgentCount, needsHumanCount, loggedCount] = await Promise.all([
    db.maintenanceRequest.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 100
    }),
    db.maintenanceRequest.count({
      where: {
        tenantId: user.tenantId,
        status: {
          in: [MaintenanceStatus.OPEN, MaintenanceStatus.IN_PROGRESS]
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
          in: [Severity.URGENT, Severity.EMERGENCY]
        }
      }
    }),
    db.maintenanceRequest.count({
      where: {
        tenantId: user.tenantId,
        status: MaintenanceStatus.NEEDS_HUMAN
      }
    }),
    db.maintenanceRequest.count({
      where: {
        tenantId: user.tenantId,
        status: MaintenanceStatus.LOGGED
      }
    })
  ]);

  return (
    <section className="panel">
      <div className="header-row">
        <div>
          <h2>Maintenance Inbox</h2>
          <p className="muted">Fast triage for repairs, incidents, and emergency handoffs.</p>
        </div>
        <span className="badge">{requests.length} records</span>
      </div>

      <div className="cards compact-cards">
        <div className="panel">
          <p className="kpi-label">Open</p>
          <p className="kpi-value">{openCount}</p>
        </div>
        <div className="panel">
          <p className="kpi-label">Urgent / Emergency</p>
          <p className="kpi-value">{urgentCount}</p>
        </div>
        <div className="panel">
          <p className="kpi-label">Needs Human</p>
          <p className="kpi-value">{needsHumanCount}</p>
        </div>
        <div className="panel">
          <p className="kpi-label">Logged</p>
          <p className="kpi-value">{loggedCount}</p>
        </div>
      </div>

      <form className="toolbar" method="get">
        <div className="filters">
          <label>
            Search
            <input name="q" defaultValue={q} placeholder="Phone, name, address, issue" />
          </label>
          <label>
            Status
            <select name="status" defaultValue={status}>
              <option value="">All</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select name="severity" defaultValue={severity}>
              <option value="">All</option>
              {SEVERITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="inline-actions">
          <button type="submit">Apply Filters</button>
          <Link className="action-link secondary" href="/inbox/maintenance">
            Reset
          </Link>
          <a className="action-link secondary" href="/api/export/maintenance">
            Export CSV
          </a>
        </div>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Caller</th>
              <th>Name</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Step</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>{formatDateTime(request.updatedAt, user.tenant.timezone)}</td>
                <td>{request.callerPhone}</td>
                <td>{request.name ?? "-"}</td>
                <td>{request.severity ?? "-"}</td>
                <td>
                  <span className={`badge ${request.status === MaintenanceStatus.NEEDS_HUMAN ? "danger" : ""}`}>
                    {request.status}
                  </span>
                </td>
                <td>{request.flowStep}</td>
                <td>
                  <Link href={`/inbox/maintenance/${request.id}`}>View</Link>
                </td>
              </tr>
            ))}
            {requests.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No maintenance requests match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

import Link from "next/link";
import { LeadIntent, LeadStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/time";

type LeadsInboxPageProps = {
  searchParams?: {
    q?: string | string[];
    status?: string | string[];
    intent?: string | string[];
  };
};

const STATUS_OPTIONS = [
  LeadStatus.OPEN,
  LeadStatus.QUALIFIED,
  LeadStatus.SCHEDULED,
  LeadStatus.NEEDS_HUMAN,
  LeadStatus.CLOSED,
  LeadStatus.OUT_OF_AREA,
  LeadStatus.OPTED_OUT
];

const INTENT_OPTIONS = [LeadIntent.VIEWING, LeadIntent.MAINTENANCE, LeadIntent.GENERAL, LeadIntent.UNKNOWN];

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function isLeadStatus(value: string): value is LeadStatus {
  return STATUS_OPTIONS.includes(value as LeadStatus);
}

function isLeadIntent(value: string): value is LeadIntent {
  return INTENT_OPTIONS.includes(value as LeadIntent);
}

export default async function LeadsInboxPage({ searchParams }: LeadsInboxPageProps) {
  const user = await requireUser();
  const q = firstValue(searchParams?.q).trim();
  const statusRaw = firstValue(searchParams?.status).trim();
  const intentRaw = firstValue(searchParams?.intent).trim();

  const status = isLeadStatus(statusRaw) ? statusRaw : "";
  const intent = isLeadIntent(intentRaw) ? intentRaw : "";

  const where: Prisma.LeadWhereInput = {
    tenantId: user.tenantId
  };

  if (status) {
    where.status = status;
  }

  if (intent) {
    where.intent = intent;
  }

  if (q) {
    where.OR = [
      { callerPhone: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { postcode: { contains: q, mode: "insensitive" } },
      { propertyQuery: { contains: q, mode: "insensitive" } },
      { desiredArea: { contains: q, mode: "insensitive" } }
    ];
  }

  const [leads, openCount, qualifiedCount, scheduledCount, needsHumanCount] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 100
    }),
    db.lead.count({
      where: {
        tenantId: user.tenantId,
        status: LeadStatus.OPEN
      }
    }),
    db.lead.count({
      where: {
        tenantId: user.tenantId,
        status: LeadStatus.QUALIFIED
      }
    }),
    db.lead.count({
      where: {
        tenantId: user.tenantId,
        status: LeadStatus.SCHEDULED
      }
    }),
    db.lead.count({
      where: {
        tenantId: user.tenantId,
        status: LeadStatus.NEEDS_HUMAN
      }
    })
  ]);

  return (
    <section className="panel">
      <div className="header-row">
        <div>
          <h2>Leads Inbox</h2>
          <p className="muted">Filter, triage, and act on viewing/general conversations quickly.</p>
        </div>
        <span className="badge">{leads.length} records</span>
      </div>

      <div className="cards compact-cards">
        <div className="panel">
          <p className="kpi-label">Open</p>
          <p className="kpi-value">{openCount}</p>
        </div>
        <div className="panel">
          <p className="kpi-label">Qualified</p>
          <p className="kpi-value">{qualifiedCount}</p>
        </div>
        <div className="panel">
          <p className="kpi-label">Scheduled</p>
          <p className="kpi-value">{scheduledCount}</p>
        </div>
        <div className="panel">
          <p className="kpi-label">Needs Human</p>
          <p className="kpi-value">{needsHumanCount}</p>
        </div>
      </div>

      <form className="toolbar" method="get">
        <div className="filters">
          <label>
            Search
            <input name="q" defaultValue={q} placeholder="Phone, name, postcode, area" />
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
            Intent
            <select name="intent" defaultValue={intent}>
              <option value="">All</option>
              {INTENT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="inline-actions">
          <button type="submit">Apply Filters</button>
          <Link className="action-link secondary" href="/inbox/leads">
            Reset
          </Link>
          <a className="action-link secondary" href="/api/export/leads">
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
              <th>Intent</th>
              <th>Status</th>
              <th>Step</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>{formatDateTime(lead.updatedAt, user.tenant.timezone)}</td>
                <td>{lead.callerPhone}</td>
                <td>{lead.name ?? "-"}</td>
                <td>{lead.intent}</td>
                <td>
                  <span className={`badge ${lead.status === LeadStatus.NEEDS_HUMAN ? "danger" : ""}`}>{lead.status}</span>
                </td>
                <td>{lead.flowStep}</td>
                <td>
                  <Link href={`/inbox/leads/${lead.id}`}>View</Link>
                </td>
              </tr>
            ))}
            {leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No leads match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

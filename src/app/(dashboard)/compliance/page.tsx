import Link from "next/link";
import { ComplianceStatus, DocumentType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/time";

type CompliancePageProps = {
  searchParams?: {
    q?: string | string[];
    status?: string | string[];
  };
};

function statusClass(status: ComplianceStatus): string {
  if (status === "OVERDUE" || status === "MISSING") {
    return "badge danger";
  }
  if (status === "DUE_SOON") {
    return "badge warn";
  }
  return "badge ok";
}

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function isComplianceStatus(value: string): value is ComplianceStatus {
  return [ComplianceStatus.OK, ComplianceStatus.DUE_SOON, ComplianceStatus.OVERDUE, ComplianceStatus.MISSING].includes(
    value as ComplianceStatus
  );
}

export default async function CompliancePage({ searchParams }: CompliancePageProps) {
  const user = await requireUser();
  const q = firstValue(searchParams?.q).trim();
  const statusRaw = firstValue(searchParams?.status).trim();
  const statusFilter = isComplianceStatus(statusRaw) ? statusRaw : "";

  const propertyWhere: Prisma.PropertyWhereInput = {
    tenantId: user.tenantId
  };
  if (q) {
    propertyWhere.OR = [
      { propertyRef: { contains: q, mode: "insensitive" } },
      { postcode: { contains: q, mode: "insensitive" } },
      { addressLine1: { contains: q, mode: "insensitive" } }
    ];
  }

  const docsWhere: Prisma.ComplianceDocumentWhereInput = {
    tenantId: user.tenantId
  };
  if (statusFilter) {
    docsWhere.status = statusFilter;
  }
  if (q) {
    const normalizedType = q.toUpperCase().replace(/[\s-]+/g, "_");
    const docTypeFilter = (Object.values(DocumentType) as string[]).includes(normalizedType)
      ? (normalizedType as DocumentType)
      : null;

    docsWhere.OR = [
      {
        property: {
          propertyRef: { contains: q, mode: "insensitive" }
        }
      },
      {
        property: {
          postcode: { contains: q, mode: "insensitive" }
        }
      },
      ...(docTypeFilter ? [{ documentType: docTypeFilter }] : [])
    ];
  }

  const [properties, docs, okCount, dueSoonCount, overdueCount, missingCount] = await Promise.all([
    db.property.findMany({
      where: propertyWhere,
      orderBy: { propertyRef: "asc" },
      include: {
        complianceDocuments: true
      }
    }),
    db.complianceDocument.findMany({
      where: docsWhere,
      include: { property: true },
      orderBy: [{ status: "desc" }, { expiryDate: "asc" }]
    }),
    db.complianceDocument.count({
      where: { tenantId: user.tenantId, status: ComplianceStatus.OK }
    }),
    db.complianceDocument.count({
      where: { tenantId: user.tenantId, status: ComplianceStatus.DUE_SOON }
    }),
    db.complianceDocument.count({
      where: { tenantId: user.tenantId, status: ComplianceStatus.OVERDUE }
    }),
    db.complianceDocument.count({
      where: { tenantId: user.tenantId, status: ComplianceStatus.MISSING }
    })
  ]);

  const summary = {
    ok: okCount,
    dueSoon: dueSoonCount,
    overdue: overdueCount,
    missing: missingCount
  };

  return (
    <section className="panel">
      <div className="header-row">
        <div>
          <h2>Compliance Overview</h2>
          <p className="muted">Track risk posture, expiry pressure, and document coverage by property.</p>
        </div>
        <span className="badge">{docs.length} docs in current view</span>
      </div>

      <div className="cards">
        <div className="panel">
          <h3>OK</h3>
          <p>{summary.ok}</p>
        </div>
        <div className="panel">
          <h3>Due Soon</h3>
          <p>{summary.dueSoon}</p>
        </div>
        <div className="panel">
          <h3>Overdue</h3>
          <p>{summary.overdue}</p>
        </div>
        <div className="panel">
          <h3>Missing</h3>
          <p>{summary.missing}</p>
        </div>
      </div>

      <form className="toolbar" method="get">
        <div className="filters">
          <label>
            Search
            <input name="q" defaultValue={q} placeholder="Property ref, postcode, address" />
          </label>
          <label>
            Status
            <select name="status" defaultValue={statusFilter}>
              <option value="">All</option>
              <option value={ComplianceStatus.OK}>{ComplianceStatus.OK}</option>
              <option value={ComplianceStatus.DUE_SOON}>{ComplianceStatus.DUE_SOON}</option>
              <option value={ComplianceStatus.OVERDUE}>{ComplianceStatus.OVERDUE}</option>
              <option value={ComplianceStatus.MISSING}>{ComplianceStatus.MISSING}</option>
            </select>
          </label>
        </div>
        <div className="inline-actions">
          <button type="submit">Apply Filters</button>
          <Link className="action-link secondary" href="/compliance">
            Reset
          </Link>
          <a className="action-link secondary" href="/api/export/compliance">
            Export CSV
          </a>
        </div>
      </form>

      <h3>Properties</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Postcode</th>
              <th>Docs</th>
              <th>Manage</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => (
              <tr key={property.id}>
                <td>{property.propertyRef}</td>
                <td>{property.postcode}</td>
                <td>{property.complianceDocuments.length}</td>
                <td>
                  <Link href={`/compliance/property/${property.id}`}>Open</Link>
                </td>
              </tr>
            ))}
            {properties.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No properties available. Add properties first.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3>Documents</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Type</th>
              <th>Status</th>
              <th>Expiry</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.property.propertyRef}</td>
                <td>{doc.documentType}</td>
                <td>
                  <span className={statusClass(doc.status)}>{doc.status}</span>
                </td>
                <td>{formatDateTime(doc.expiryDate, user.tenant.timezone)}</td>
                <td>{doc.filePath ?? "-"}</td>
              </tr>
            ))}
            {docs.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No compliance documents match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

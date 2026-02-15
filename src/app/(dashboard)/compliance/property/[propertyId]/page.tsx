import { DocumentType } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  deriveComplianceStatus,
  parseCompliancePolicy,
  scheduleComplianceReminderJobsForDocument
} from "@/lib/compliance";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { saveUploadedFile } from "@/lib/uploads";

const DOCUMENT_TYPES: DocumentType[] = [
  DocumentType.EPC,
  DocumentType.GAS_SAFETY,
  DocumentType.EICR,
  DocumentType.SMOKE_CO,
  DocumentType.LEGIONELLA,
  DocumentType.OTHER
];

type PropertyComplianceDetailPageProps = {
  params: {
    propertyId: string;
  };
  searchParams?: {
    saved?: string;
    refreshed?: string;
    error?: string;
  };
};

function toDateOrNull(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function statusClass(status: string): string {
  if (status === "OVERDUE" || status === "MISSING") {
    return "badge danger";
  }
  if (status === "DUE_SOON") {
    return "badge warn";
  }
  return "badge ok";
}

async function saveComplianceDocAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireUser();
  const propertyId = String(formData.get("propertyId") ?? "");
  const documentTypeRaw = String(formData.get("documentType") ?? "");
  const issueDate = toDateOrNull(String(formData.get("issueDate") ?? ""));
  const expiryDate = toDateOrNull(String(formData.get("expiryDate") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim();
  const file = formData.get("documentFile");

  if (!propertyId || !DOCUMENT_TYPES.includes(documentTypeRaw as DocumentType)) {
    redirect(`/compliance/property/${propertyId || "unknown"}?error=invalid_document_input`);
  }

  const property = await db.property.findFirst({
    where: {
      id: propertyId,
      tenantId: user.tenantId
    },
    include: { tenant: true }
  });
  if (!property) {
    notFound();
  }

  const uploadPath =
    file instanceof File && file.size > 0
      ? await saveUploadedFile(file, {
          subdir: `tenant_${user.tenantId}/property_${property.id}`
        })
      : null;

  const policy = parseCompliancePolicy(property.tenant.compliancePolicyJson);
  const status = deriveComplianceStatus(expiryDate, new Date(), policy);
  const documentType = documentTypeRaw as DocumentType;

  const existing = await db.complianceDocument.findUnique({
    where: {
      propertyId_documentType: {
        propertyId: property.id,
        documentType
      }
    }
  });

  const doc = existing
    ? await db.complianceDocument.update({
        where: { id: existing.id },
        data: {
          issueDate,
          expiryDate,
          notes: notes || null,
          status,
          filePath: uploadPath ?? existing.filePath
        }
      })
    : await db.complianceDocument.create({
        data: {
          tenantId: user.tenantId,
          propertyId: property.id,
          documentType,
          issueDate,
          expiryDate,
          notes: notes || null,
          status,
          filePath: uploadPath
        }
      });

  await scheduleComplianceReminderJobsForDocument(doc.id);
  redirect(`/compliance/property/${property.id}?saved=1`);
}

async function refreshSchedulesAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireUser();
  const propertyId = String(formData.get("propertyId") ?? "");
  const property = await db.property.findFirst({
    where: {
      id: propertyId,
      tenantId: user.tenantId
    },
    include: {
      complianceDocuments: {
        select: { id: true }
      }
    }
  });

  if (!property) {
    redirect("/compliance?error=property_not_found");
  }

  for (const doc of property.complianceDocuments) {
    await scheduleComplianceReminderJobsForDocument(doc.id);
  }

  redirect(`/compliance/property/${property.id}?refreshed=1`);
}

export default async function PropertyComplianceDetailPage({
  params,
  searchParams
}: PropertyComplianceDetailPageProps) {
  const user = await requireUser();

  const property = await db.property.findFirst({
    where: {
      id: params.propertyId,
      tenantId: user.tenantId
    },
    include: {
      complianceDocuments: {
        orderBy: [{ documentType: "asc" }]
      }
    }
  });

  if (!property) {
    notFound();
  }

  const feedback = searchParams?.saved
    ? "Compliance document saved."
    : searchParams?.refreshed
      ? "Reminder schedules refreshed."
      : searchParams?.error
        ? "Action failed. Check input and try again."
        : null;

  return (
    <section className="panel">
      <div className="header-row">
        <div>
          <h2>Compliance: {property.propertyRef}</h2>
          <p className="muted">
            {property.addressLine1}, {property.postcode}
          </p>
        </div>
      </div>

      {feedback ? <p className="muted">{feedback}</p> : null}

      <div className="cards">
        <section className="panel">
          <h3>Add / Update Document</h3>
          <form className="grid" action={saveComplianceDocAction}>
            <input type="hidden" name="propertyId" value={property.id} />

            <label>
              Document Type
              <select name="documentType" required>
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Issue Date
              <input name="issueDate" type="date" />
            </label>

            <label>
              Expiry Date
              <input name="expiryDate" type="date" />
            </label>

            <label>
              Document File
              <input name="documentFile" type="file" />
            </label>

            <label>
              Notes
              <textarea name="notes" rows={3} />
            </label>

            <button type="submit">Save Document</button>
          </form>
        </section>

        <section className="panel">
          <h3>Reminders</h3>
          <p className="muted">
            Reminders are scheduled for 30/14/7 days pre-expiry and weekly once overdue (policy-configurable).
          </p>
          <form action={refreshSchedulesAction}>
            <input type="hidden" name="propertyId" value={property.id} />
            <button type="submit">Refresh Reminder Schedule</button>
          </form>
        </section>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Status</th>
              <th>Issue Date</th>
              <th>Expiry Date</th>
              <th>File Path</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {property.complianceDocuments.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.documentType}</td>
                <td>
                  <span className={statusClass(doc.status)}>{doc.status}</span>
                </td>
                <td>{formatDateTime(doc.issueDate, user.tenant.timezone)}</td>
                <td>{formatDateTime(doc.expiryDate, user.tenant.timezone)}</td>
                <td>{doc.filePath ?? "-"}</td>
                <td>{doc.notes ?? "-"}</td>
              </tr>
            ))}
            {property.complianceDocuments.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No compliance documents found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

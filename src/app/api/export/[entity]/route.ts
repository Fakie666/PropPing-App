import { ComplianceStatus, LeadIntent, LeadStatus, MaintenanceStatus, Severity } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  return lines.join("\n");
}

function jsonCsvResponse(filename: string, csvBody: string): Response {
  return new Response(csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}

export async function GET(_request: Request, context: { params: { entity: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const entity = context.params.entity;
  const timestamp = new Date().toISOString().slice(0, 10);

  if (entity === "leads") {
    const leads = await db.lead.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 5000
    });

    const headers = [
      "id",
      "createdAt",
      "updatedAt",
      "callerPhone",
      "name",
      "intent",
      "status",
      "flowStep",
      "desiredArea",
      "postcode",
      "propertyQuery",
      "requirements",
      "notes"
    ];

    const rows = leads.map((lead) => ({
      id: lead.id,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
      callerPhone: lead.callerPhone,
      name: lead.name,
      intent: lead.intent as LeadIntent,
      status: lead.status as LeadStatus,
      flowStep: lead.flowStep,
      desiredArea: lead.desiredArea,
      postcode: lead.postcode,
      propertyQuery: lead.propertyQuery,
      requirements: lead.requirements,
      notes: lead.notes
    }));

    return jsonCsvResponse(`propping-leads-${timestamp}.csv`, toCsv(headers, rows));
  }

  if (entity === "maintenance") {
    const maintenance = await db.maintenanceRequest.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 5000
    });

    const headers = [
      "id",
      "createdAt",
      "updatedAt",
      "callerPhone",
      "name",
      "status",
      "severity",
      "flowStep",
      "propertyAddress",
      "postcode",
      "issueDescription",
      "needsHuman",
      "notes"
    ];

    const rows = maintenance.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      callerPhone: row.callerPhone,
      name: row.name,
      status: row.status as MaintenanceStatus,
      severity: row.severity as Severity | null,
      flowStep: row.flowStep,
      propertyAddress: row.propertyAddress,
      postcode: row.postcode,
      issueDescription: row.issueDescription,
      needsHuman: row.needsHuman,
      notes: row.notes
    }));

    return jsonCsvResponse(`propping-maintenance-${timestamp}.csv`, toCsv(headers, rows));
  }

  if (entity === "properties") {
    const properties = await db.property.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { propertyRef: "asc" },
      include: {
        _count: {
          select: { complianceDocuments: true }
        }
      }
    });

    const headers = [
      "id",
      "propertyRef",
      "addressLine1",
      "addressLine2",
      "city",
      "postcode",
      "notes",
      "complianceDocumentCount",
      "createdAt",
      "updatedAt"
    ];

    const rows = properties.map((row) => ({
      id: row.id,
      propertyRef: row.propertyRef,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      postcode: row.postcode,
      notes: row.notes,
      complianceDocumentCount: row._count.complianceDocuments,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));

    return jsonCsvResponse(`propping-properties-${timestamp}.csv`, toCsv(headers, rows));
  }

  if (entity === "compliance") {
    const docs = await db.complianceDocument.findMany({
      where: { tenantId: user.tenantId },
      include: { property: true },
      orderBy: [{ status: "desc" }, { expiryDate: "asc" }],
      take: 5000
    });

    const headers = [
      "id",
      "propertyRef",
      "propertyPostcode",
      "documentType",
      "status",
      "issueDate",
      "expiryDate",
      "filePath",
      "lastReminderAt",
      "notes",
      "createdAt",
      "updatedAt"
    ];

    const rows = docs.map((row) => ({
      id: row.id,
      propertyRef: row.property.propertyRef,
      propertyPostcode: row.property.postcode,
      documentType: row.documentType,
      status: row.status as ComplianceStatus,
      issueDate: row.issueDate?.toISOString() ?? null,
      expiryDate: row.expiryDate?.toISOString() ?? null,
      filePath: row.filePath,
      lastReminderAt: row.lastReminderAt?.toISOString() ?? null,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));

    return jsonCsvResponse(`propping-compliance-${timestamp}.csv`, toCsv(headers, rows));
  }

  return new Response("Not found", { status: 404 });
}

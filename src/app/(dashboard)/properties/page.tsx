import Link from "next/link";
import { DocumentType, Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { parsePropertyCsv } from "@/lib/csv";
import { db } from "@/lib/db";

const DEFAULT_DOCUMENT_TYPES: DocumentType[] = [
  DocumentType.EPC,
  DocumentType.GAS_SAFETY,
  DocumentType.EICR,
  DocumentType.SMOKE_CO,
  DocumentType.LEGIONELLA
];

type PropertiesPageProps = {
  searchParams?: {
    created?: string;
    imported?: string;
    error?: string;
    q?: string | string[];
  };
};

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

async function ensureDefaultComplianceDocs(tenantId: string, propertyId: string): Promise<void> {
  await db.complianceDocument.createMany({
    data: DEFAULT_DOCUMENT_TYPES.map((documentType) => ({
      tenantId,
      propertyId,
      documentType,
      status: "MISSING"
    })),
    skipDuplicates: true
  });
}

async function createPropertyAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireUser();
  const propertyRef = String(formData.get("propertyRef") ?? "").trim();
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim();
  const addressLine2 = String(formData.get("addressLine2") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const postcode = String(formData.get("postcode") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!propertyRef || !addressLine1 || !postcode) {
    redirect("/properties?error=missing_required_fields");
  }

  const property = await db.property.upsert({
    where: {
      tenantId_propertyRef: {
        tenantId: user.tenantId,
        propertyRef
      }
    },
    update: {
      addressLine1,
      addressLine2: addressLine2 || null,
      city: city || null,
      postcode,
      notes: notes || null
    },
    create: {
      tenantId: user.tenantId,
      propertyRef,
      addressLine1,
      addressLine2: addressLine2 || null,
      city: city || null,
      postcode,
      notes: notes || null
    }
  });

  await ensureDefaultComplianceDocs(user.tenantId, property.id);
  redirect("/properties?created=1");
}

async function importCsvAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireUser();
  const csvFile = formData.get("csvFile");
  if (!(csvFile instanceof File) || csvFile.size === 0) {
    redirect("/properties?error=missing_csv_file");
  }

  let rows;
  try {
    rows = parsePropertyCsv(await csvFile.text());
  } catch {
    redirect("/properties?error=invalid_csv_format");
  }

  let imported = 0;
  for (const row of rows) {
    const property = await db.property.upsert({
      where: {
        tenantId_propertyRef: {
          tenantId: user.tenantId,
          propertyRef: row.propertyRef
        }
      },
      update: {
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        city: row.city,
        postcode: row.postcode,
        notes: row.notes
      },
      create: {
        tenantId: user.tenantId,
        propertyRef: row.propertyRef,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        city: row.city,
        postcode: row.postcode,
        notes: row.notes
      }
    });

    await ensureDefaultComplianceDocs(user.tenantId, property.id);
    imported += 1;
  }

  redirect(`/properties?imported=${imported}`);
}

function messageFromParams(searchParams: PropertiesPageProps["searchParams"]): string | null {
  if (!searchParams) {
    return null;
  }

  if (searchParams.error === "missing_required_fields") {
    return "Missing required fields for property creation.";
  }
  if (searchParams.error === "missing_csv_file") {
    return "Please attach a CSV file.";
  }
  if (searchParams.error === "invalid_csv_format") {
    return "CSV format is invalid. Required headers: propertyRef,addressLine1,postcode.";
  }
  if (searchParams.created) {
    return "Property saved.";
  }
  if (searchParams.imported) {
    return `CSV import completed. Rows processed: ${searchParams.imported}.`;
  }

  return null;
}

export default async function PropertiesPage({ searchParams }: PropertiesPageProps) {
  const user = await requireUser();
  const q = firstValue(searchParams?.q).trim();

  const where: Prisma.PropertyWhereInput = {
    tenantId: user.tenantId
  };
  if (q) {
    where.OR = [
      { propertyRef: { contains: q, mode: "insensitive" } },
      { postcode: { contains: q, mode: "insensitive" } },
      { addressLine1: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } }
    ];
  }

  const properties = await db.property.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { complianceDocuments: true }
      }
    }
  });

  const feedback = messageFromParams(searchParams);

  return (
    <section className="panel">
      <div className="header-row">
        <div>
          <h2>Properties</h2>
          <p className="muted">Add single properties or bulk import CSV.</p>
        </div>
        <span className="badge">{properties.length} properties</span>
      </div>

      {feedback ? <p className="muted">{feedback}</p> : null}

      <form className="toolbar" method="get">
        <div className="filters">
          <label>
            Search
            <input name="q" defaultValue={q} placeholder="Ref, postcode, address, city" />
          </label>
        </div>
        <div className="inline-actions">
          <button type="submit">Apply Filters</button>
          <Link className="action-link secondary" href="/properties">
            Reset
          </Link>
          <a className="action-link secondary" href="/api/export/properties">
            Export CSV
          </a>
        </div>
      </form>

      <div className="cards">
        <section className="panel">
          <h3>Add Property</h3>
          <form className="grid" action={createPropertyAction}>
            <label>
              Property Ref*
              <input name="propertyRef" placeholder="LON-101" required />
            </label>
            <label>
              Address Line 1*
              <input name="addressLine1" placeholder="101 Example Street" required />
            </label>
            <label>
              Address Line 2
              <input name="addressLine2" />
            </label>
            <label>
              City
              <input name="city" />
            </label>
            <label>
              Postcode*
              <input name="postcode" placeholder="SW1A 1AA" required />
            </label>
            <label>
              Notes
              <textarea name="notes" rows={3} />
            </label>
            <button type="submit">Save Property</button>
          </form>
        </section>

        <section className="panel">
          <h3>CSV Import</h3>
          <p className="muted">Required headers: `propertyRef,addressLine1,postcode`</p>
          <p className="muted">Optional headers: `addressLine2,city,notes`</p>
          <form className="grid" action={importCsvAction}>
            <label>
              CSV File
              <input name="csvFile" type="file" accept=".csv,text/csv" required />
            </label>
            <button type="submit">Import CSV</button>
          </form>
        </section>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Address</th>
              <th>Postcode</th>
              <th>Compliance Docs</th>
              <th>Compliance</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => (
              <tr key={property.id}>
                <td>{property.propertyRef}</td>
                <td>
                  {property.addressLine1}
                  {property.city ? `, ${property.city}` : ""}
                </td>
                <td>{property.postcode}</td>
                <td>{property._count.complianceDocuments}</td>
                <td>
                  <Link href={`/compliance/property/${property.id}`}>Manage</Link>
                </td>
              </tr>
            ))}
            {properties.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No properties found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

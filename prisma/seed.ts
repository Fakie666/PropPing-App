import {
  ComplianceStatus,
  DocumentType,
  LeadIntent,
  LeadStatus,
  MessageDirection,
  MaintenanceStatus,
  PrismaClient,
  UserRole
} from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { twilioPhoneNumber: "+442071234567" },
    update: {
      name: "PropPing Demo"
    },
    create: {
      name: "PropPing Demo",
      twilioPhoneNumber: "+442071234567",
      forwardToPhoneNumber: "+447700900111",
      ownerNotificationPhoneNumber: "+447700900222",
      timezone: "Europe/London",
      businessHoursJson: {
        monday: ["09:00", "17:30"],
        tuesday: ["09:00", "17:30"],
        wednesday: ["09:00", "17:30"],
        thursday: ["09:00", "17:30"],
        friday: ["09:00", "17:30"]
      },
      allowedPostcodePrefixes: ["SW", "SE", "E", "N", "W"],
      bookingUrlViewings: "https://example.com/book-viewing",
      bookingUrlCalls: "https://example.com/book-call",
      messageTemplatesJson: {
        missedCallTriage:
          "Sorry we missed your call - are you contacting us about: 1) Renting/viewing a property 2) A repair/maintenance issue 3) Something else. Reply 1, 2, or 3.",
        calmDeescalation:
          "Thanks for raising this. We are sorry for the frustration. A human colleague will review and contact you within one business day."
      },
      compliancePolicyJson: {
        dueSoonDays: [30, 14, 7],
        overdueReminderDays: 7
      }
    }
  });

  const adminPassword = "DemoPass123!";
  const passwordHash = await hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: "admin@demo.propping.local" },
    update: {
      tenantId: tenant.id,
      role: UserRole.ADMIN,
      passwordHash
    },
    create: {
      tenantId: tenant.id,
      email: "admin@demo.propping.local",
      role: UserRole.ADMIN,
      passwordHash
    }
  });

  const propertySeeds = [
    {
      propertyRef: "LON-001",
      addressLine1: "10 King Street",
      city: "London",
      postcode: "SW1A 1AA"
    },
    {
      propertyRef: "LON-002",
      addressLine1: "22 River Road",
      city: "London",
      postcode: "SE1 7PB"
    },
    {
      propertyRef: "LON-003",
      addressLine1: "4 Station Terrace",
      city: "London",
      postcode: "E2 8AA"
    }
  ] as const;

  const properties = await Promise.all(
    propertySeeds.map((property) =>
      prisma.property.upsert({
        where: {
          tenantId_propertyRef: {
            tenantId: tenant.id,
            propertyRef: property.propertyRef
          }
        },
        update: {
          addressLine1: property.addressLine1,
          city: property.city,
          postcode: property.postcode
        },
        create: {
          tenantId: tenant.id,
          propertyRef: property.propertyRef,
          addressLine1: property.addressLine1,
          city: property.city,
          postcode: property.postcode
        }
      })
    )
  );

  await prisma.complianceDocument.deleteMany({
    where: { tenantId: tenant.id }
  });

  await prisma.complianceDocument.createMany({
    data: [
      {
        tenantId: tenant.id,
        propertyId: properties[0].id,
        documentType: DocumentType.EPC,
        status: ComplianceStatus.OK,
        expiryDate: new Date("2027-06-30T00:00:00.000Z"),
        filePath: "uploads/demo/lon-001-epc.pdf"
      },
      {
        tenantId: tenant.id,
        propertyId: properties[1].id,
        documentType: DocumentType.GAS_SAFETY,
        status: ComplianceStatus.DUE_SOON,
        expiryDate: new Date("2026-03-20T00:00:00.000Z"),
        filePath: "uploads/demo/lon-002-gas.pdf"
      },
      {
        tenantId: tenant.id,
        propertyId: properties[2].id,
        documentType: DocumentType.EICR,
        status: ComplianceStatus.OVERDUE,
        expiryDate: new Date("2025-12-15T00:00:00.000Z"),
        filePath: "uploads/demo/lon-003-eicr.pdf"
      }
    ]
  });

  await prisma.message.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.lead.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.maintenanceRequest.deleteMany({ where: { tenantId: tenant.id } });

  const lead = await prisma.lead.create({
    data: {
      tenantId: tenant.id,
      callerPhone: "+447700900123",
      intent: LeadIntent.VIEWING,
      status: LeadStatus.OPEN,
      flowStep: 1,
      name: "Alex Carter",
      desiredArea: "Southwark",
      requirements: "2 bed, up to GBP 2,100/month"
    }
  });

  await prisma.message.create({
    data: {
      tenantId: tenant.id,
      direction: MessageDirection.OUTBOUND,
      fromPhone: tenant.twilioPhoneNumber,
      toPhone: lead.callerPhone,
      body: "Hi Alex, thanks for your call. Are you looking for a viewing or maintenance support?",
      leadId: lead.id
    }
  });

  const maintenance = await prisma.maintenanceRequest.create({
    data: {
      tenantId: tenant.id,
      callerPhone: "+447700900124",
      status: MaintenanceStatus.OPEN,
      flowStep: 2,
      name: "Jamie Singh",
      propertyAddress: "22 River Road, London",
      issueDescription: "Boiler pressure keeps dropping."
    }
  });

  await prisma.message.create({
    data: {
      tenantId: tenant.id,
      direction: MessageDirection.INBOUND,
      fromPhone: maintenance.callerPhone,
      toPhone: tenant.twilioPhoneNumber,
      body: "The boiler pressure keeps dropping overnight.",
      maintenanceRequestId: maintenance.id
    }
  });

  console.log("Seed complete");
  console.log("Demo login email: admin@demo.propping.local");
  console.log("Demo login password: DemoPass123!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

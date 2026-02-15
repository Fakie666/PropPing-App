import Link from "next/link";
import type { ReactNode } from "react";
import { ComplianceStatus, LeadStatus, MaintenanceStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/inbox/leads", label: "Inbox - Leads" },
  { href: "/inbox/maintenance", label: "Inbox - Maintenance" },
  { href: "/properties", label: "Properties" },
  { href: "/compliance", label: "Compliance" },
  { href: "/settings", label: "Settings" },
  { href: "/test", label: "Test SMS" }
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  const [openLeads, openMaintenance, needsHumanLeads, needsHumanMaintenance, complianceRiskDocs] = await Promise.all([
    db.lead.count({
      where: {
        tenantId: user.tenantId,
        status: {
          in: [LeadStatus.OPEN, LeadStatus.QUALIFIED]
        }
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
        status: {
          in: [ComplianceStatus.OVERDUE, ComplianceStatus.MISSING]
        }
      }
    })
  ]);

  const humanHandoffCount = needsHumanLeads + needsHumanMaintenance;
  const attentionCount = humanHandoffCount + complianceRiskDocs;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-icon" aria-hidden>
            PP
          </span>
          <div>
            <h1>PropPing</h1>
            <p>
              {user.tenant.name}
              <br />
              {user.email}
            </p>
          </div>
        </div>

        <nav>
          {NAV_ITEMS.map((item) => (
            <Link className="link" key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-section">
          <p className="sidebar-heading">Ops Pulse</p>
          <div className="ops-metric">
            <span>Active Conversations</span>
            <strong>{openLeads + openMaintenance}</strong>
          </div>
          <div className="ops-metric">
            <span>Human Handoffs</span>
            <strong>{humanHandoffCount}</strong>
          </div>
          <div className="ops-metric">
            <span>Compliance Risks</span>
            <strong>{complianceRiskDocs}</strong>
          </div>
          <div className="ops-metric">
            <span>Total Attention Needed</span>
            <strong>{attentionCount}</strong>
          </div>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-heading">Export Data</p>
          <a className="link subtle" href="/api/export/leads">
            Leads CSV
          </a>
          <a className="link subtle" href="/api/export/maintenance">
            Maintenance CSV
          </a>
          <a className="link subtle" href="/api/export/properties">
            Properties CSV
          </a>
          <a className="link subtle" href="/api/export/compliance">
            Compliance CSV
          </a>
        </div>

        <form action="/logout" method="post">
          <button className="logout-button" type="submit">
            Log out
          </button>
        </form>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}

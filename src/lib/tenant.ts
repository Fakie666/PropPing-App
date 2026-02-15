import { db } from "@/lib/db";

function normalizePhone(value: string): string {
  const compact = value.replace(/[\s()-]/g, "");
  if (compact.startsWith("00")) {
    return `+${compact.slice(2)}`;
  }
  return compact;
}

export async function findTenantByTwilioNumber(toPhoneRaw: string | null | undefined) {
  if (!toPhoneRaw) {
    return null;
  }

  const normalized = normalizePhone(toPhoneRaw);
  const variants = Array.from(
    new Set([
      toPhoneRaw,
      toPhoneRaw.trim(),
      normalized,
      normalized.startsWith("+") ? normalized.slice(1) : `+${normalized}`
    ])
  ).filter(Boolean);

  return db.tenant.findFirst({
    where: {
      twilioPhoneNumber: {
        in: variants
      }
    }
  });
}

export { normalizePhone };

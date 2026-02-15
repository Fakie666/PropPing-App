import { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSessionToken, parseSessionToken } from "@/lib/session";

const SESSION_COOKIE_NAME = "propping_session";

function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production.");
  }

  return "propping-dev-secret-change-me";
}

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  tenant: {
    id: string;
    name: string;
    timezone: string;
    twilioPhoneNumber: string;
    ownerNotificationPhoneNumber: string;
  };
};

export async function loginWithPassword(email: string, password: string): Promise<{ ok: true } | { ok: false }> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          timezone: true,
          twilioPhoneNumber: true,
          ownerNotificationPhoneNumber: true
        }
      }
    }
  });

  if (!user) {
    return { ok: false };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { ok: false };
  }

  const token = createSessionToken(
    {
      userId: user.id,
      tenantId: user.tenantId
    },
    getSessionSecret()
  );

  cookies().set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60
  });

  return { ok: true };
}

export async function clearUserSession(): Promise<void> {
  cookies().delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = parseSessionToken(token, getSessionSecret());
  if (!session) {
    return null;
  }

  const user = await db.user.findFirst({
    where: {
      id: session.userId,
      tenantId: session.tenantId
    },
    select: {
      id: true,
      tenantId: true,
      email: true,
      role: true,
      tenant: {
        select: {
          id: true,
          name: true,
          timezone: true,
          twilioPhoneNumber: true,
          ownerNotificationPhoneNumber: true
        }
      }
    }
  });

  return user;
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

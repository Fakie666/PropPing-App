import { hash, compare } from "bcryptjs";

export async function hashPassword(input: string): Promise<string> {
  return hash(input, 10);
}

export async function verifyPassword(input: string, passwordHash: string): Promise<boolean> {
  return compare(input, passwordHash);
}

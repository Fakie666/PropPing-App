import { promises as fs } from "node:fs";
import path from "node:path";

type SaveUploadOptions = {
  subdir?: string;
};

function sanitizePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function resolveUploadsRoot(): string {
  const configured = process.env.UPLOAD_DIR?.trim() || "uploads";
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export async function saveUploadedFile(file: File, options: SaveUploadOptions = {}): Promise<string | null> {
  if (!file || file.size === 0) {
    return null;
  }

  const uploadsRoot = resolveUploadsRoot();
  const subdir = options.subdir ? sanitizePart(options.subdir) : "documents";
  const targetDir = path.join(uploadsRoot, subdir);
  await fs.mkdir(targetDir, { recursive: true });

  const extension = path.extname(file.name || "").slice(0, 10);
  const base = path.basename(file.name || "upload", extension);
  const filename = `${sanitizePart(base)}_${Date.now()}${sanitizePart(extension)}`;
  const fullPath = path.join(targetDir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return path.relative(process.cwd(), fullPath).replace(/\\/g, "/");
}

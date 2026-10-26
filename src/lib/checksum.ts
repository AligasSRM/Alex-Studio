import crypto from "crypto";
import fs from "fs";

export function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function sha256Content(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

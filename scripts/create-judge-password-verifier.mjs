import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const rl = createInterface({ input: stdin, output: stdout });
try {
  const password = await rl.question("Enter a unique judge preview password (20+ characters): ");
  if (password.length < 20) throw new Error("Password must contain at least 20 characters.");
  const salt = randomBytes(18);
  console.log(`scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`);
} finally { rl.close(); }

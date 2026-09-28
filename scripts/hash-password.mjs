#!/usr/bin/env node
// Prints an argon2id hash for ADMIN_PASSWORD_HASH. Requires Node >= 24.7.
//   Interactive:  npm run hash-password
//   Scripted:     printf '%s' "$PASSWORD" | node scripts/hash-password.mjs
//   --env         print a .env-ready line with "$" escaped for dotenv.
import { argon2, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const MIN_LENGTH = 12;

function readHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(prompt)) process.stdout.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function readPassword() {
  if (!process.stdin.isTTY) return readStdin();
  const first = await readHidden("New admin password: ");
  const second = await readHidden("Repeat password: ");
  if (first !== second) throw new Error("Passwords do not match");
  return first;
}

function hash(password) {
  const salt = randomBytes(16);
  const params = { message: password, nonce: salt, memory: 65536, passes: 3, parallelism: 4, tagLength: 32 };
  return new Promise((resolve, reject) => {
    argon2("argon2id", params, (err, key) => {
      if (err) return reject(err);
      const b64 = (b) => b.toString("base64").replace(/=+$/, "");
      resolve(`$argon2id$v=19$m=65536,t=3,p=4$${b64(salt)}$${b64(key)}`);
    });
  });
}

try {
  if (typeof argon2 !== "function") throw new Error("Node >= 24.7 is required (crypto.argon2)");
  const password = await readPassword();
  if (password.length < MIN_LENGTH) throw new Error(`Password must be at least ${MIN_LENGTH} characters`);
  const encoded = await hash(password);
  const asEnv = process.argv.includes("--env");
  process.stdout.write(asEnv ? `ADMIN_PASSWORD_HASH=${encoded.replaceAll("$", "\\$")}\n` : `${encoded}\n`);
} catch (error) {
  process.stderr.write(`hash-password: ${error.message}\n`);
  process.exit(1);
}

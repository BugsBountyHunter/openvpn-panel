import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { hashPassword, isSupportedHash, parseArgon2, verifyPassword } from "./password";

describe("argon2id hashes", () => {
  it("round-trips", async () => {
    const encoded = await hashPassword("correct horse battery");
    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
    expect(isSupportedHash(encoded)).toBe(true);
    expect(await verifyPassword("correct horse battery", encoded)).toBe(true);
    expect(await verifyPassword("wrong horse battery", encoded)).toBe(false);
  });

  it("rejects hostile parameters", () => {
    expect(parseArgon2("$argon2id$v=19$m=99999999,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA")).toBeNull();
    expect(parseArgon2("$argon2i$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA")).toBeNull();
  });
});

describe("bcrypt hashes", () => {
  it("verifies $2b$ and htpasswd-style $2y$", async () => {
    const encoded = bcrypt.hashSync("s3cret-password", 4);
    expect(await verifyPassword("s3cret-password", encoded)).toBe(true);
    expect(await verifyPassword("s3cret-password", encoded.replace(/^\$2b\$/, "$2y$"))).toBe(true);
    expect(await verifyPassword("nope", encoded)).toBe(false);
  });
});

describe("verifyPassword", () => {
  it("fails closed on unknown formats and empty input", async () => {
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("", await hashPassword("abc"))).toBe(false);
  });
});

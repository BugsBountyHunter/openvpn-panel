import { describe, expect, it } from "vitest";
import { clearedSessionCookie, sessionCookie } from "./cookie";

describe("session cookie options", () => {
  it("is httpOnly and SameSite=Strict", () => {
    expect(sessionCookie("t", "http://10.8.0.1:8081/")).toMatchObject({ httpOnly: true, sameSite: "strict", secure: false });
  });

  it("is Secure over https", () => {
    expect(sessionCookie("t", "https://vpn.example/").secure).toBe(true);
  });

  it("clears with maxAge 0", () => {
    expect(clearedSessionCookie("http://x/")).toMatchObject({ value: "", maxAge: 0 });
  });
});

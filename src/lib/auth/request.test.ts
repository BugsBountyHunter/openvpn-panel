import { describe, expect, it } from "vitest";
import { clientIp, isMutation, isSameOriginRequest, readSessionCookie } from "./request";

const h = (init: Record<string, string>) => new Headers(init);

describe("isSameOriginRequest", () => {
  it("accepts matching origin and host", () => {
    expect(isSameOriginRequest(h({ origin: "http://10.8.0.1:8081", host: "10.8.0.1:8081" }))).toBe(true);
  });

  it("rejects missing, foreign or cross-site requests", () => {
    expect(isSameOriginRequest(h({ host: "10.8.0.1:8081" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "https://evil.example", host: "10.8.0.1:8081" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "null", host: "10.8.0.1:8081" }))).toBe(false);
    expect(
      isSameOriginRequest(
        h({ origin: "http://10.8.0.1:8081", host: "10.8.0.1:8081", "sec-fetch-site": "cross-site" }),
      ),
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("classifies methods", () => {
    expect(isMutation("GET")).toBe(false);
    expect(isMutation("post")).toBe(true);
    expect(isMutation("DELETE")).toBe(true);
  });

  it("extracts a sane client ip", () => {
    expect(clientIp(h({ "x-forwarded-for": "::ffff:10.8.0.6" }))).toBe("10.8.0.6");
    expect(clientIp(h({ "x-forwarded-for": "10.8.0.2, 1.1.1.1" }))).toBe("10.8.0.2");
    expect(clientIp(h({ "x-forwarded-for": "<script>" }))).toBe("unknown");
    expect(clientIp(h({}))).toBe("unknown");
  });

  it("reads the session cookie", () => {
    expect(readSessionCookie("a=1; ovpn_panel_session=abc.def; b=2")).toBe("abc.def");
    expect(readSessionCookie("a=1")).toBeUndefined();
  });
});

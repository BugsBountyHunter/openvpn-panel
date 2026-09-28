// Production entry point, copied next to the standalone server.js in releases.
//  - Maps PANEL_HOST/PANEL_PORT to the HOSTNAME/PORT that server.js reads
//    (server.js alone would default to 0.0.0.0).
//  - The panel is served directly, not behind a reverse proxy, so any
//    client-supplied forwarding headers are dropped and X-Forwarded-For is set
//    from the socket. This keeps audit IPs and login rate limits honest.
import http from "node:http";

const FORWARDING_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-real-ip"];

const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function emit(event, ...args) {
  if (event === "request") {
    const [req] = args;
    for (const header of FORWARDING_HEADERS) delete req.headers[header];
    req.headers["x-forwarded-for"] = req.socket?.remoteAddress ?? "";
  }
  return originalEmit.call(this, event, ...args);
};

process.env.HOSTNAME = process.env.PANEL_HOST || "127.0.0.1";
process.env.PORT = process.env.PANEL_PORT || "8081";
process.env.NODE_ENV = "production";

await import("./server.js");

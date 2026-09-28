import { createConnection, type Socket } from "node:net";
import type { MgmtAddress } from "./address";

/**
 * Minimal OpenVPN management-interface client.
 *
 * The management interface serves ONE client at a time, so every call opens a
 * fresh connection, runs its commands, sends `quit` and disconnects. Calls are
 * serialized through an in-process queue and bounded by short timeouts so a
 * stuck socket can never wedge the panel.
 */

export class MgmtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MgmtError";
  }
}

export interface MgmtClientOptions {
  address: MgmtAddress;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
}

export interface MgmtSession {
  /** Runs a command whose reply is a single SUCCESS:/ERROR: line; returns it raw. */
  single(command: string): Promise<string>;
  /** Runs a command whose reply is a block terminated by END; returns the lines. */
  multi(command: string): Promise<string[]>;
}

const COMMAND_PATTERN = /^[A-Za-z0-9 _.-]{1,128}$/;

function assertSafeCommand(command: string): void {
  // Commands are newline-delimited; never let a value inject a second command.
  if (!COMMAND_PATTERN.test(command)) throw new MgmtError("Refusing to send unsafe management command");
}

/** Line-oriented reader over a socket with per-read timeouts. */
class LineReader {
  private buffer = "";
  private lines: string[] = [];
  private waiter: { resolve: (line: string) => void; reject: (err: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.push(chunk));
    socket.on("error", (err) => this.fail(new MgmtError(`Management socket error: ${err.message}`)));
    socket.on("close", () => this.fail(new MgmtError("Management connection closed")));
  }

  private push(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.startsWith("ENTER PASSWORD:")) {
      this.fail(new MgmtError("Management interface asks for a password, which is not supported"));
      return;
    }
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    for (const part of parts) this.lines.push(part.replace(/\r$/, ""));
    this.flush();
  }

  private flush(): void {
    if (!this.waiter) return;
    if (this.lines.length > 0) {
      const { resolve } = this.waiter;
      this.waiter = null;
      resolve(this.lines.shift() as string);
    } else if (this.failure) {
      const { reject } = this.waiter;
      this.waiter = null;
      reject(this.failure);
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.flush();
  }

  next(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new MgmtError("Timed out waiting for the management interface"));
      }, timeoutMs);
      this.waiter = {
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      this.flush();
    });
  }

  /** Next line that is not an asynchronous `>NOTIFICATION`. */
  async nextReply(timeoutMs: number): Promise<string> {
    for (;;) {
      const line = await this.next(timeoutMs);
      if (!line.startsWith(">")) return line;
    }
  }
}

function connect(address: MgmtAddress, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket =
      address.kind === "unix"
        ? createConnection({ path: address.path })
        : createConnection({ host: address.host, port: address.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new MgmtError("Timed out connecting to the management interface"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(new MgmtError(`Cannot reach the management interface: ${err.message}`));
    });
  });
}

/** Sends `quit` and waits (briefly) for the server to hang up, so the next
 * session never overlaps: the interface only accepts one client at a time. */
function closeGracefully(socket: Socket, timeoutMs = 500): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.destroy();
      resolve();
    }, timeoutMs);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.end("quit\n");
  });
}

export class MgmtClient {
  private queue: Promise<void> = Promise.resolve();
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;

  constructor(private readonly options: MgmtClientOptions) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 2000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 3000;
  }

  /** Runs `fn` with exclusive use of a fresh management connection. */
  session<T>(fn: (session: MgmtSession) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => this.runSession(fn));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runSession<T>(fn: (session: MgmtSession) => Promise<T>): Promise<T> {
    const socket = await connect(this.options.address, this.connectTimeoutMs);
    const reader = new LineReader(socket);
    const timeout = this.commandTimeoutMs;
    try {
      // Wait for the greeting: ">INFO:OpenVPN Management Interface Version N ..."
      for (;;) {
        const line = await reader.next(timeout);
        if (line.startsWith(">INFO:")) break;
      }
      const session: MgmtSession = {
        single: async (command) => {
          assertSafeCommand(command);
          socket.write(`${command}\n`);
          const line = await reader.nextReply(timeout);
          if (!line.startsWith("SUCCESS:") && !line.startsWith("ERROR:")) {
            throw new MgmtError(`Unexpected management reply to "${command.split(" ")[0]}"`);
          }
          return line;
        },
        multi: async (command) => {
          assertSafeCommand(command);
          socket.write(`${command}\n`);
          const lines: string[] = [];
          for (;;) {
            const line = await reader.nextReply(timeout);
            if (line === "END") return lines;
            if (lines.length === 0 && line.startsWith("ERROR:")) {
              throw new MgmtError(`Management command failed: ${line.slice(6).trim()}`);
            }
            lines.push(line);
          }
        },
      };
      return await fn(session);
    } finally {
      await closeGracefully(socket);
    }
  }
}

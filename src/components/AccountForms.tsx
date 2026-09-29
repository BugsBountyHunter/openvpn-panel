"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { NEW_PASSWORD_MAX, NEW_PASSWORD_MIN } from "@/lib/auth/password-policy";
import { apiPost, UnauthorizedError } from "./api-client";
import { Button } from "./Modal";

const INPUT = "mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

type Feedback = { tone: "ok" | "error"; text: string } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return feedback.tone === "ok" ? (
    <p role="status" className="text-sm text-ok">{feedback.text}</p>
  ) : (
    <p role="alert" className="text-sm text-danger">{feedback.text}</p>
  );
}

/** Runs an API call, sending the admin to /login if the session is gone. */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function run(action: () => Promise<void>, success: string): Promise<boolean> {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ tone: "ok", text: success });
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return false;
      }
      setFeedback({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, feedback, run };
}

export function ChangePasswordForm() {
  const { busy, feedback, run } = useAction();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const lengthOk = next.length >= NEW_PASSWORD_MIN && next.length <= NEW_PASSWORD_MAX;
  const matches = next === confirm;
  const canSubmit = current !== "" && lengthOk && matches && next !== current && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const ok = await run(
      () => apiPost("/api/auth/password", { currentPassword: current, newPassword: next }),
      "Password changed. Every other session was signed out.",
    );
    // Clear the fields either way; nothing sensitive stays in the page.
    setCurrent("");
    if (ok) {
      setNext("");
      setConfirm("");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 p-4" aria-label="Change password">
      <div>
        <label htmlFor="current-password" className="text-sm font-medium">Current password</label>
        <input id="current-password" type="password" autoComplete="current-password" value={current}
          onChange={(e) => setCurrent(e.target.value)} maxLength={1024} className={INPUT} />
      </div>
      <div>
        <label htmlFor="new-password" className="text-sm font-medium">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" value={next}
          onChange={(e) => setNext(e.target.value)} maxLength={NEW_PASSWORD_MAX} className={INPUT}
          aria-invalid={next !== "" && !lengthOk} />
        <p className="mt-1.5 text-xs text-muted">
          At least {NEW_PASSWORD_MIN} characters. A long passphrase is best.
        </p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="text-sm font-medium">Confirm new password</label>
        <input id="confirm-password" type="password" autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} maxLength={NEW_PASSWORD_MAX} className={INPUT}
          aria-invalid={confirm !== "" && !matches} />
        {confirm !== "" && !matches ? <p className="mt-1.5 text-xs text-danger">Passwords do not match.</p> : null}
      </div>
      <FeedbackLine feedback={feedback} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}

export function SignOutOthers() {
  const { busy, feedback, run } = useAction();
  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted">
        Signs out every browser that is signed in to the panel, except this one. Use it if a device was lost or you
        signed in somewhere you no longer trust.
      </p>
      <FeedbackLine feedback={feedback} />
      <div className="flex justify-end">
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => run(() => apiPost("/api/auth/sessions"), "Every other session was signed out.")}
        >
          {busy ? "Signing out…" : "Sign out other sessions"}
        </Button>
      </div>
    </div>
  );
}

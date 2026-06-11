import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { sendOperatorMessage } from "@/lib/operator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/operator")({
  component: OperatorDashboard,
  head: () => ({
    meta: [
      { title: "Operator Dashboard" },
      { name: "description", content: "Send messages to operators via Make.com webhook." },
    ],
  }),
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button
          onClick={() => {
            reset();
            router.invalidate();
          }}
        >
          Retry
        </Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function OperatorDashboard() {
  const send = useServerFn(sendOperatorMessage);
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<null | { ok: boolean; error?: string; status?: number; response?: string }>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const res = await send({ data: { message, phone: phone || undefined } });
      setResult(res);
      if (res.ok) setMessage("");
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Operator Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Send an operator message via the Make.com webhook configured in the{" "}
          <code>MAKE_OPERATOR_WEBHOOK</code> secret.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="message">Message</Label>
          <Textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            required
            placeholder="Type the message to send to the operator…"
          />
        </div>
        <Button type="submit" disabled={pending || message.trim().length === 0}>
          {pending ? "Sending…" : "Send to operator"}
        </Button>
      </form>

      {result && (
        <div
          className={`rounded-md border p-3 text-sm ${
            result.ok ? "border-green-500/40 bg-green-500/10" : "border-destructive/40 bg-destructive/10"
          }`}
        >
          {result.ok ? (
            <p>Sent successfully{result.status ? ` (HTTP ${result.status})` : ""}.</p>
          ) : (
            <p>Failed: {result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

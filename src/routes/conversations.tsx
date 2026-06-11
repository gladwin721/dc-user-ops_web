import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getConversations } from "@/lib/conversations.functions";

const conversationsQuery = queryOptions({
  queryKey: ["conversations"],
  queryFn: () => getConversations(),
});

export const Route = createFileRoute("/conversations")({
  head: () => ({
    meta: [
      { title: "Conversations — Supabase Connectivity Test" },
      { name: "description", content: "Reads from the existing Supabase conversations table to verify connectivity." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(conversationsQuery),
  component: ConversationsPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">Failed to load conversations</h1>
        <pre className="mt-3 whitespace-pre-wrap rounded bg-muted p-3 text-sm">{error.message}</pre>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          Try again
        </button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function ConversationsPage() {
  const { data } = useSuspenseQuery(conversationsQuery);
  const { rows, error } = data;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Live read from the external Supabase <code className="rounded bg-muted px-1">conversations</code> table.
      </p>

      {error ? (
        <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <strong>Supabase error:</strong> {error}
          <p className="mt-2 text-muted-foreground">
            Most common cause: RLS on <code>conversations</code> doesn't allow the anon role to SELECT.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          Connection succeeded, but 0 rows were returned. Check RLS policies for the anon role.
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">phone</th>
                <th className="px-3 py-2 font-medium">mode</th>
                <th className="px-3 py-2 font-medium">area</th>
                <th className="px-3 py-2 font-medium">booking_date</th>
                <th className="px-3 py-2 font-medium">booking_time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">{r.phone ?? "—"}</td>
                  <td className="px-3 py-2">{r.mode ?? "—"}</td>
                  <td className="px-3 py-2">{r.area ?? "—"}</td>
                  <td className="px-3 py-2">{r.booking_date ?? "—"}</td>
                  <td className="px-3 py-2">{r.booking_time ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

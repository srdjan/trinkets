
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { openJsonlStoreWithHeadsV2 } from "./store_jsonl_heads_v2.ts";
import { ready as readyBase, explainBlocked } from "./query.ts";
import { filterIssues, ready as readyFiltered, nextWork } from "./search.ts";
import { openKvCache } from "./cache_kv.ts";

export type HttpOptions = Readonly<{
  baseDir?: string;
  port?: number;
  cache?: "kv" | "none";
  validateEvents?: boolean;
  cors?: { origin?: "*" | string | string[] };
  etag?: "weak" | "none";
}>;

export async function startHttp(opts: HttpOptions = {}) {
  const baseDir = opts.baseDir ?? ".trinkets";
  const store = await openJsonlStoreWithHeadsV2({ baseDir, validateEvents: !!opts.validateEvents });
  const cache = opts.cache === "kv" ? await openKvCache("trinkets", baseDir) : null;

  async function getGraph() {
    if (cache) { const g = await cache.hydrate(); if (g) return g; }
    const g = await store.materialize(); if (cache) await cache.persist(g); return g;
  }

  const handler = async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(opts.cors?.origin ?? "*") });
    const url = new URL(req.url);
    const g = await getGraph();
    const tag = opts.etag === "none" ? null : makeETag(g);

    if (tag && req.headers.get("if-none-match") === tag) {
      return new Response(null, { status: 304, headers: { ...cors(opts.cors?.origin ?? "*"), etag: tag } });
    }

    if (url.pathname === "/") return html(indexHtml(), 200, opts);
    if (url.pathname === "/ready") {
      const label = url.searchParams.get("label") ?? undefined;
      const text = url.searchParams.get("text") ?? undefined;
      const data = label || text ? readyFiltered(g, { label, text }) : readyBase(g);
      return json({ count: data.length, items: data }, 200, opts, tag);
    }
    if (url.pathname.startsWith("/issue/")) {
      const id = decodeURIComponent(url.pathname.slice("/issue/".length));
      const issue = g.issues.get(id as any);
      if (!issue) return json({ error: "not found", id }, 404, opts, tag);
      return json(issue, 200, opts, tag);
    }
    if (url.pathname === "/search") {
      const label = url.searchParams.get("label") ?? undefined;
      const text = url.searchParams.get("text") ?? undefined;
      return json({ items: filterIssues(g, { label, text }) }, 200, opts, tag);
    }
    if (url.pathname === "/next") {
      const strategy = (url.searchParams.get("strategy") ?? "priority-first") as any;
      const label = url.searchParams.get("label") ?? undefined;
      const text = url.searchParams.get("text") ?? undefined;
      return json({ item: nextWork(g, { label, text }, strategy) }, 200, opts, tag);
    }
    if (url.pathname === "/graph/summary") {
      return json({ issues: g.issues.size, edges: Array.from(g.outgoing.values()).reduce((n, arr) => n + arr.length, 0) }, 200, opts, tag);
    }
    if (url.pathname === "/blocked") {
      return html(blockedHtml(g), 200, opts);
    }
    return json({ ok: true, endpoints: ["/", "/ready", "/issue/:id", "/search", "/next", "/graph/summary", "/blocked"] }, 200, opts, tag);
  };

  const port = opts.port ?? 8787;
  console.log(`trinkets http on http://localhost:${port}`);
  return serve(handler, { port });
}

function cors(origin: "*" | string | string[] = "*") {
  const allow = Array.isArray(origin) ? origin.join(",") : origin;
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
function json(data: unknown, status = 200, opts: HttpOptions, tag: string | null): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", ...cors(opts.cors?.origin ?? "*"), ...(tag ? { etag: tag } : {}) } });
}
function html(s: string, status = 200, opts: HttpOptions): Response {
  return new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8", ...cors(opts.cors?.origin ?? "*") } });
}
function makeETag(g: any): string {
  const key = `${g.issues.size}:${Array.from(g.outgoing.values()).reduce((n,a)=>n+a.length,0)}`;
  let h = 0; for (let i = 0; i < key.length; i++) h = (h*31 + key.charCodeAt(i)) >>> 0;
  return `W/"${h.toString(16)}-${key.length}"`;
}
function indexHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>trinkets</title>
  <script src="https://unpkg.com/htmx.org@2.0.8"></script>
  <style>
    body{font-family:system-ui,ui-sans-serif;margin:2rem}
    .card{border:1px solid #ddd;border-radius:12px;padding:1rem;margin-bottom:1rem;box-shadow:0 1px 2px rgba(0,0,0,0.04)}
    .pill{display:inline-block;padding:.1rem .5rem;border-radius:999px;background:#f1f5f9;color:#334155;font-size:.8rem}
    table{border-collapse:collapse;width:100%} th,td{padding:.5rem;border-bottom:1px solid #eee;text-align:left}
  </style>
</head>
<body>
  <h1>trinkets — Ready</h1>
  <div class="card" hx-get="/ready" hx-trigger="load, every 3s" hx-target="#ready" hx-swap="innerHTML">
    <div id="ready">Loading…</div>
  </div>
  <div class="card" hx-get="/blocked" hx-trigger="load, every 5s" hx-swap="outerHTML"><div>Loading blocked…</div></div>
  <div class="card">
    <h2>Search</h2>
    <form hx-get="/search" hx-target="#results" hx-trigger="submit">
      <input name="text" placeholder="contains text"/>
      <input name="label" placeholder="label"/>
      <button>Go</button>
    </form>
    <div id="results">Enter query</div>
  </div>
  <script>
    document.body.addEventListener('htmx:afterOnLoad', (ev) => {
      try {
        const res = JSON.parse(ev.detail.xhr.responseText || "{}");
        if (ev.detail.requestConfig.path && ev.detail.requestConfig.path.endsWith('/ready')) {
          const el = document.querySelector('#ready');
          el.innerHTML = '<table><thead><tr><th>ID</th><th>Title</th><th>P</th></tr></thead><tbody>' +
            (res.items||[]).map(i => '<tr><td><code>'+i.id+'</code></td><td>'+i.title+'</td><td><span class="pill">'+i.priority+'</span></td></tr>').join('') +
            '</tbody></table>';
        } else if (ev.detail.requestConfig.path && ev.detail.requestConfig.path.startsWith('/search')) {
          const el = document.querySelector('#results');
          el.innerHTML = '<ul>' + (res.items||[]).map(i => '<li><code>'+i.id+'</code> — '+i.title+'</li>').join('') + '</ul>';
        }
      } catch {}
    });
  </script>
</body>
</html>`;
}
function escapeHtml(s: string) { return s.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] as string)); }
function blockedHtml(g: any): string {
  const blocked: any[] = [];
  for (const issue of g.issues.values()) {
    const blockers = (g.incoming.get(issue.id) ?? []).filter((l: any) => l.type === "blocks").map((l: any) => l.from);
    const openBlockers = blockers.filter((bid: string) => { const up = g.issues.get(bid); return up && up.status !== "done" && up.status !== "canceled"; });
    if (issue.status !== "done" && openBlockers.length > 0) blocked.push({ issue, blockers: openBlockers });
  }
  if (blocked.length === 0) return `<div class="card"><h2>Blocked</h2><p>None 🎉</p></div>`;
  return `<div class="card"><h2>Blocked</h2>
    <table><thead><tr><th>ID</th><th>Title</th><th>Blockers</th></tr></thead><tbody>
      ${blocked.map(b => `<tr><td><code>${b.issue.id}</code></td><td>${escapeHtml(b.issue.title)}</td><td>${b.blockers.map((id: string) => `<code>${id}</code>`).join(", ")}</td></tr>`).join("")}
    </tbody></table></div>`;
}

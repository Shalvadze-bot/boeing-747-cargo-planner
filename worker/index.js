const projectsPath = "/api/projects";
const maxBodyBytes = 2_000_000;

function reply(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function displayName(request, email) {
  let name = request.headers.get('oai-authenticated-user-full-name') ?? '';
  if (request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { name = decodeURIComponent(name); } catch { name = ''; }
  }
  return (name.trim() || email.split('@')[0]).slice(0, 100);
}

async function handleProjects(request, url, env) {
  const owner = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!owner || !email) return reply({ error: "ChatGPT oturumu gerekiyor." }, 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.CARGO_WORKER_TOKEN) {
    return reply({ error: "Bulut kaydı şu anda kullanılamıyor." }, 503);
  }

  const id = url.pathname === projectsPath ? null : url.pathname.slice(projectsPath.length + 1);
  if (id !== null && !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) {
    return reply({ error: "Proje bulunamadı." }, 404);
  }

  let operation;
  let input = {};
  const members = id && url.searchParams.has('members');
  if (request.method === "GET") {
    operation = members ? 'members' : id ? (url.searchParams.has('version') ? 'version' : 'read') : 'list';
  } else {
    if (request.headers.get("Origin") !== url.origin) return reply({ error: "Geçersiz istek." }, 403);
    if (request.method === "DELETE" && id) {
      operation = "delete";
    } else if (request.method === 'POST' && id && url.searchParams.has('presence')) {
      operation = 'presence';
    } else if ((request.method === 'POST' && (!id || members)) || (request.method === 'PATCH' && id)) {
      if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
        return reply({ error: "Geçersiz veri biçimi." }, 415);
      }
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).length > maxBodyBytes) {
          return reply({ error: "Proje verisi çok büyük." }, 413);
        }
        input = JSON.parse(raw);
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid body");
      } catch {
        return reply({ error: "Proje bilgileri okunamadı." }, 400);
      }
      if (members) {
        if (request.method !== 'POST' || !['grant', 'revoke'].includes(input.action) || typeof input.email !== 'string') {
          return reply({ error: 'Geçersiz erişim isteği.' }, 400);
        }
        operation = input.action;
      } else {
        operation = !id ? 'create' : Object.hasOwn(input, 'payload') ? 'save' : 'rename';
      }
    } else {
      return reply({ error: "Geçersiz işlem." }, 405);
    }
  }

  try {
    const result = await fetch(new URL("/functions/v1/cargo-sites", env.SUPABASE_URL), {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        "X-Cargo-Worker-Token": env.CARGO_WORKER_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        owner, email, id, operation, name: input.name,
        activity: true, actor: displayName(request, email), member: input.email,
        payload: input.payload, expected: input.expected,
      }),
    });
    const data = await result.json();
    if (!result.ok && ![400, 403, 404, 409, 413].includes(result.status)) {
      return reply({ error: "Supabase bağlantısı şu anda kullanılamıyor." }, 502);
    }
    return reply(operation === "list" && result.ok ? { projects: data } : data, result.status);
  } catch {
    return reply({ error: "Supabase bağlantısı kurulamadı." }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === projectsPath || url.pathname.startsWith(`${projectsPath}/`)) {
      return handleProjects(request, url, env);
    }
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};

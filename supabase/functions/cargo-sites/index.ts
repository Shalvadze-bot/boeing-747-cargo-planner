Deno.serve(async (request: Request) => {
  const reply = (body: unknown, status: number) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const token = request.headers.get("X-Cargo-Worker-Token") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return reply({ error: "Unauthorized" }, 401);

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 2_100_000) {
      return reply({ error: "Proje verisi çok büyük." }, 413);
    }
    const { operation, owner, email, id, name, payload, expected, activity, actor, member } = JSON.parse(raw);
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    if (!key || !url) return reply({ error: "Supabase bağlantısı kullanılamıyor." }, 503);

    const rpc = activity === true ? 'cargo_sites_activity_request' : 'cargo_sites_request';
    const result = await fetch(new URL('/rest/v1/rpc/' + rpc, url), {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        worker_token: token, operation, site_owner: owner, site_email: email,
        project_id: id ?? null, project_name: name ?? null,
        project_payload: payload ?? null, expected_updated_at: expected ?? null,
        ...(activity === true ? { actor_name: actor ?? null, member_email: member ?? null } : {}),
      }),
    });
    const data = await result.json();
    if (!result.ok) {
      if (data.code === "42501") return reply({ error: "Unauthorized" }, 401);
      if (String(data.code).startsWith("22")) return reply({ error: "Proje bilgileri geçersiz." }, 400);
      console.error("Cargo database error", data.code);
      return reply({ error: "Projeler veritabanından alınamadı." }, 502);
    }
    if (data?.notFound) return reply({ error: "Proje bulunamadı." }, 404);
    if (data?.forbidden) return reply({ error: 'Bu işlem proje sahibine açık.' }, 403);
    if (data?.conflict) return reply({ error: "Proje başka cihazda güncellendi." }, 409);
    return reply(data, 200);
  } catch (error) {
    console.error("Cargo function error", error instanceof Error ? error.name : "unknown");
    return reply({ error: "Proje bağlantısı kurulamadı." }, 502);
  }
});

// Cifras públicas de redes de Preparador OGC para el resumen diario de la secretaria (sin datos personales).
// Escribe sync/redes/estado/metricas.json. Nunca falla el workflow: si algo no se puede leer, lo anota en «errores».
import { writeFileSync, readFileSync, existsSync } from "node:fs";
const V = process.env.META_GRAPH_VERSION || "v24.0";
const G = `https://graph.facebook.com/${V}`;
const PAGE_ID = process.env.META_PAGE_ID_OGC || "1380006258537627";
const SALIDA = "sync/redes/estado/metricas.json";
const userToken = process.env.META_ACCESS_TOKEN;
const limpiar = (s) => String(s).replace(/access_token=[^&"\s]+/g, "access_token=***").replace(/EAA[A-Za-z0-9]+/g, "***");
async function get(ruta, params, token) {
  const u = new URL(`${G}/${ruta}`);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  const r = await fetch(u); const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(limpiar(`${ruta}: ${d.error?.code ?? r.status} ${d.error?.message ?? ""}`));
  return d;
}
const out = { fecha: new Date().toISOString(), errores: [] };
try {
  const cuentas = await get("me/accounts", { fields: "id,name,access_token", limit: "100" }, userToken);
  const pag = (cuentas.data || []).find((p) => p.id === PAGE_ID) || (cuentas.data || []).find((p) => /ogc|organizaci/i.test(p.name || ""));
  if (!pag) throw new Error("página no encontrada");
  const pt = pag.access_token; if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${pt}`);
  try {
    const f = await get(pag.id, { fields: "followers_count,fan_count,instagram_business_account{id}" }, pt);
    out.facebook = { seguidores: f.followers_count ?? null, me_gusta_pagina: f.fan_count ?? null };
    const igId = f.instagram_business_account?.id;
    try {
      const posts = await get(`${pag.id}/posts`, { fields: "created_time,message,reactions.summary(true),comments.summary(true),shares", limit: "5" }, pt);
      out.facebook.ultimas = (posts.data || []).map((p) => ({ fecha: p.created_time, texto: (p.message || "").slice(0, 60), reacciones: p.reactions?.summary?.total_count ?? null, comentarios: p.comments?.summary?.total_count ?? null, compartidos: p.shares?.count ?? 0 }));
    } catch (e) { out.errores.push(`facebook posts: ${limpiar(e.message)}`); }
    if (igId) {
      try {
        const ig = await get(igId, { fields: "username,followers_count,follows_count,media_count" }, pt);
        out.instagram = { usuario: ig.username, seguidores: ig.followers_count, publicaciones: ig.media_count };
        const m = await get(`${igId}/media`, { fields: "timestamp,caption,like_count,comments_count,media_type,permalink", limit: "5" }, pt);
        out.instagram.ultimas = (m.data || []).map((x) => ({ fecha: x.timestamp, tipo: x.media_type, texto: (x.caption || "").slice(0, 60), me_gusta: x.like_count ?? null, comentarios: x.comments_count ?? null, enlace: x.permalink }));
      } catch (e) { out.errores.push(`instagram: ${limpiar(e.message)}`); }
    }
  } catch (e) { out.errores.push(`facebook: ${limpiar(e.message)}`); }
} catch (e) { out.errores.push(limpiar(e.message)); }
// Histórico corto de seguidores (1 punto por día) para ver la evolución
let hist = [];
try { if (existsSync(SALIDA)) hist = JSON.parse(readFileSync(SALIDA, "utf8")).historico || []; } catch {}
const dia = out.fecha.slice(0, 10);
hist = hist.filter((h) => h.dia !== dia);
hist.push({ dia, ig: out.instagram?.seguidores ?? null, fb: out.facebook?.seguidores ?? null });
out.historico = hist.slice(-60);
writeFileSync(SALIDA, JSON.stringify(out, null, 2) + "\n");
console.log(`Métricas: IG ${out.instagram?.seguidores ?? "?"} · FB ${out.facebook?.seguidores ?? "?"} · errores ${out.errores.length}`);

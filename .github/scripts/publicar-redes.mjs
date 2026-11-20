// Publicación automática de Preparador OGC en Instagram (@preparadorogc) y Facebook (página Preparador OGC).
// Copia adaptada de scripts/publicar-redes.mjs de PGA (19-20/11/2026). Sin IA y sin coste: solo la Graph API de Meta.
//
// Cola: sync/redes/manifiesto.json (la misma que lee el plugin «OGC Redes»), con publicaciones
//   { id, utc, tipo: CAROUSEL|IMAGE|REELS, medios[{ruta,tipo}], pie_ig, pie_fb, retenida }.
// Registro: sync/redes/estado/publicadas.json (id → ids de Meta y hora). Nunca se publica dos veces el mismo id.
// Pausa: si existe sync/redes/PAUSA, no se publica nada.
//
// Secreto: META_ACCESS_TOKEN (token del usuario del sistema web-pga, guardado por Vicente). Con él se piden
// el token y el id de la página Preparador OGC (/me/accounts) y el id de Instagram (instagram_business_account).
// Ningún token se imprime: el workflow los enmascara y aquí solo se registran ids públicos.
//
// Uso: node .github/scripts/publicar-redes.mjs [--diagnostico] [--dry-run]
//   --diagnostico: comprueba token, página, Instagram, medios y crea un contenedor de prueba SIN publicar.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const V = process.env.META_GRAPH_VERSION || "v24.0";
const G = `https://graph.facebook.com/${V}`;
const PAGE_ID = process.env.META_PAGE_ID_OGC || "1380006258537627";
const REPO = process.env.GITHUB_REPOSITORY || "preparadorpga/web-ogc";
const SHA = process.env.MEDIA_SHA || "main";
const DIAG = process.argv.includes("--diagnostico");
const DRY = process.argv.includes("--dry-run");
const MARGEN_H = 72; // una pieza con más de 72 h de retraso ya no se publica (se marca «caducada»)
const MAX_POR_RUN = 2;

const MANIFIESTO = "sync/redes/manifiesto.json";
const ESTADO_DIR = "sync/redes/estado";
const REGISTRO = `${ESTADO_DIR}/publicadas.json`;
const DIAG_FILE = `${ESTADO_DIR}/diagnostico.json`;

const userToken = process.env.META_ACCESS_TOKEN;
let pageToken = null;

const limpiar = (s) => String(s).replace(/access_token=[^&"\s]+/g, "access_token=***").replace(/EAA[A-Za-z0-9]+/g, "***");

async function api(metodo, ruta, params = {}, token = pageToken) {
  const url = new URL(`${G}/${ruta}`);
  const init = { method: metodo };
  if (metodo === "GET" || metodo === "DELETE") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
  } else {
    init.body = new URLSearchParams({ ...params, access_token: token });
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw new Error(limpiar(`${metodo} ${ruta}: ${e.code ?? res.status} ${e.error_subcode ?? ""} ${e.message ?? JSON.stringify(data)}`));
  }
  return data;
}

async function credenciales() {
  if (!userToken) throw new Error("Falta el secreto META_ACCESS_TOKEN");
  // /me/accounts da el token de cada página asignada al usuario del sistema
  let paginas = [];
  let sig = `me/accounts`;
  let params = { fields: "id,name,access_token,tasks", limit: "100" };
  const r = await api("GET", sig, params, userToken);
  paginas = r.data || [];
  let pag = paginas.find((p) => p.id === PAGE_ID) || paginas.find((p) => /ogc|organizaci/i.test(p.name || ""));
  if (!pag) {
    // Plan B: pedir el token directamente a la página
    const d = await api("GET", PAGE_ID, { fields: "id,name,access_token" }, userToken);
    if (!d.access_token) throw new Error(`La página ${PAGE_ID} no está entre las asignadas (${paginas.map((p) => p.name).join(", ") || "ninguna"})`);
    pag = d;
  }
  pageToken = pag.access_token;
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${pageToken}`);
  const ig = await api("GET", pag.id, { fields: "instagram_business_account{id,username}" });
  const igc = ig.instagram_business_account;
  if (!igc?.id) throw new Error("La página no tiene una cuenta de Instagram profesional vinculada");
  return { pageId: pag.id, pageName: pag.name, tasks: pag.tasks || [], igId: igc.id, igUser: igc.username, paginasVisibles: paginas.map((p) => p.name) };
}

// URL pública de un medio. raw.githubusercontent.com fijado al commit (inmutable); si el tipo MIME que sirve
// no coincide (p. ej. vídeo como octet-stream), se usa jsDelivr fijado al mismo commit.
const cacheUrl = new Map();
async function urlMedio(m) {
  if (cacheUrl.has(m.ruta)) return cacheUrl.get(m.ruta);
  const cands = [
    `https://raw.githubusercontent.com/${REPO}/${SHA}/sync/redes/${m.ruta}`,
    `https://cdn.jsdelivr.net/gh/${REPO}@${SHA}/sync/redes/${m.ruta}`,
  ];
  let elegida = null;
  const pruebas = [];
  for (const u of cands) {
    try {
      const r = await fetch(u, { method: "HEAD" });
      const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
      pruebas.push({ url: u, estado: r.status, tipo: ct });
      if (r.ok && ct === m.tipo) { elegida = u; break; }
    } catch (e) { pruebas.push({ url: u, error: String(e.message) }); }
  }
  if (!elegida) throw new Error(`Ningún servidor da ${m.ruta} como ${m.tipo}: ${JSON.stringify(pruebas)}`);
  cacheUrl.set(m.ruta, elegida);
  return elegida;
}

async function listo(id, intentos = 36) {
  for (let i = 0; i < intentos; i++) {
    const j = await api("GET", id, { fields: "status_code,status" });
    if (j.status_code === "FINISHED") return id;
    if (j.status_code === "ERROR" || j.status_code === "EXPIRED") throw new Error(`contenedor ${id}: ${j.status_code} ${j.status ?? ""}`);
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  throw new Error(`contenedor ${id}: no terminó de procesarse`);
}

async function publicarIG(c, p) {
  const caption = p.pie_ig;
  if (p.tipo === "REELS") {
    const video = p.medios.find((m) => m.tipo.startsWith("video/"));
    const { id } = await api("POST", `${c.igId}/media`, { media_type: "REELS", video_url: await urlMedio(video), caption, share_to_feed: "true" });
    return (await api("POST", `${c.igId}/media_publish`, { creation_id: await listo(id, 90) })).id;
  }
  if (p.tipo === "CAROUSEL") {
    const hijos = [];
    for (const m of p.medios.slice(0, 10)) {
      const { id } = await api("POST", `${c.igId}/media`, { image_url: await urlMedio(m), is_carousel_item: "true" });
      hijos.push(await listo(id));
    }
    const { id } = await api("POST", `${c.igId}/media`, { media_type: "CAROUSEL", children: hijos.join(","), caption });
    return (await api("POST", `${c.igId}/media_publish`, { creation_id: await listo(id) })).id;
  }
  const { id } = await api("POST", `${c.igId}/media`, { image_url: await urlMedio(p.medios[0]), caption });
  return (await api("POST", `${c.igId}/media_publish`, { creation_id: await listo(id) })).id;
}

async function publicarFB(c, p) {
  const texto = p.pie_fb;
  if (p.tipo === "REELS") {
    const video = p.medios.find((m) => m.tipo.startsWith("video/"));
    return (await api("POST", `${c.pageId}/videos`, { file_url: await urlMedio(video), description: texto })).id;
  }
  if (p.medios.length > 1) {
    const ids = [];
    for (const m of p.medios.slice(0, 10)) ids.push((await api("POST", `${c.pageId}/photos`, { url: await urlMedio(m), published: "false" })).id);
    const adj = Object.fromEntries(ids.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })]));
    return (await api("POST", `${c.pageId}/feed`, { message: texto, ...adj })).id;
  }
  const r = await api("POST", `${c.pageId}/photos`, { url: await urlMedio(p.medios[0]), caption: texto });
  return r.post_id || r.id;
}

const leer = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d);
const guardar = (f, o) => { mkdirSync(ESTADO_DIR, { recursive: true }); writeFileSync(f, JSON.stringify(o, null, 2) + "\n"); };
const ahoraIso = () => new Date().toISOString();

async function diagnostico() {
  const inf = { fecha: ahoraIso(), version_graph: V, commit_medios: SHA, pasos: [] };
  const paso = (nombre, ok, detalle) => { inf.pasos.push({ nombre, ok, ...(detalle ? { detalle: limpiar(detalle) } : {}) }); console.log(ok ? "✔" : "✘", nombre, detalle ? limpiar(detalle) : ""); };
  let c;
  try {
    c = await credenciales();
    paso("Token válido y página encontrada", true, `${c.pageName} (${c.pageId}); tareas: ${c.tasks.join(",") || "—"}`);
    paso("Instagram vinculado", true, `@${c.igUser} (${c.igId})`);
    inf.pagina = { id: c.pageId, nombre: c.pageName, tareas: c.tasks };
    inf.instagram = { id: c.igId, usuario: c.igUser };
  } catch (e) { paso("Credenciales", false, e.message); guardar(DIAG_FILE, { ...inf, resultado: "ERROR" }); return false; }

  try {
    const l = await api("GET", `${c.igId}/content_publishing_limit`, { fields: "quota_usage,config" });
    paso("Cupo de publicación de Instagram", true, JSON.stringify(l.data?.[0] ?? l));
  } catch (e) { paso("Cupo de publicación de Instagram", false, e.message); }

  const man = leer(MANIFIESTO, { publicaciones: [] });
  const img = man.publicaciones.find((p) => p.tipo !== "REELS")?.medios?.[0];
  const vid = man.publicaciones.find((p) => p.tipo === "REELS")?.medios?.find((m) => m.tipo.startsWith("video/"));
  for (const m of [img, vid].filter(Boolean)) {
    try { paso(`Medio accesible (${m.tipo})`, true, await urlMedio(m)); } catch (e) { paso(`Medio accesible (${m.tipo})`, false, e.message); }
  }

  // Contenedor de Instagram SIN publicar (caduca solo a las 24 h; no aparece en el perfil)
  try {
    const { id } = await api("POST", `${c.igId}/media`, { image_url: await urlMedio(img), caption: "Prueba técnica (no se publica)" });
    await listo(id);
    paso("Instagram: contenedor de prueba creado y procesado (sin publicar)", true, id);
  } catch (e) { paso("Instagram: contenedor de prueba", false, e.message); }

  // Foto de Facebook sin publicar, que se borra al momento
  try {
    const { id } = await api("POST", `${c.pageId}/photos`, { url: await urlMedio(img), published: "false" });
    let borrada = false;
    try { await api("DELETE", id); borrada = true; } catch {}
    paso("Facebook: foto de prueba sin publicar", true, `${id}${borrada ? " (borrada)" : " (no se pudo borrar; es invisible)"}`);
  } catch (e) { paso("Facebook: foto de prueba sin publicar", false, e.message); }

  const reg = leer(REGISTRO, {});
  const prox = man.publicaciones.filter((p) => !p.retenida && !reg[p.id]).sort((a, b) => a.utc.localeCompare(b.utc))[0];
  inf.proxima = prox ? { id: prox.id, utc: prox.utc, tipo: prox.tipo } : null;
  inf.resultado = inf.pasos.every((p) => p.ok) ? "OK" : "CON ERRORES";
  guardar(DIAG_FILE, inf);
  console.log("Resultado:", inf.resultado);
  return inf.resultado === "OK";
}

async function publicarCola() {
  if (existsSync("sync/redes/PAUSA")) { console.log("Pausa activada (sync/redes/PAUSA): no se publica nada."); return; }
  const man = leer(MANIFIESTO, { publicaciones: [] });
  const reg = leer(REGISTRO, {});
  const ahora = Date.now();
  const vencidas = man.publicaciones
    .filter((p) => !p.retenida && Date.parse(p.utc) <= ahora)
    .filter((p) => !reg[p.id] || (reg[p.id].estado === "parcial"))
    .sort((a, b) => a.utc.localeCompare(b.utc));
  if (!vencidas.length) { console.log("Nada que publicar ahora."); return; }
  let c = null;
  let hechas = 0;
  for (const p of vencidas) {
    const r = reg[p.id] || {};
    if (ahora - Date.parse(p.utc) > MARGEN_H * 3600e3 && !r.instagram && !r.facebook) {
      reg[p.id] = { estado: "caducada", nota: `más de ${MARGEN_H} h de retraso`, revisado: ahoraIso() };
      console.log("⏭", p.id, "caducada");
      continue;
    }
    if (hechas >= MAX_POR_RUN) break;
    if (DRY) { console.log("[dry-run]", p.id, p.tipo, p.utc); continue; }
    c ??= await credenciales();
    const fila = { ...r, utc_previsto: p.utc };
    for (const red of ["instagram", "facebook"]) {
      if (fila[red]) continue;
      try {
        fila[red] = red === "instagram" ? await publicarIG(c, p) : await publicarFB(c, p);
        fila[`${red}_hora`] = ahoraIso();
        delete fila[`${red}_error`];
        console.log("✔", p.id, red, fila[red]);
      } catch (e) {
        fila[`${red}_error`] = limpiar(e.message).slice(0, 400);
        fila.intentos = (fila.intentos || 0) + 1;
        console.error("✘", p.id, red, limpiar(e.message));
      }
    }
    fila.estado = fila.instagram && fila.facebook ? "publicada" : (fila.intentos >= 3 ? "error" : "parcial");
    reg[p.id] = fila;
    hechas++;
  }
  guardar(REGISTRO, reg);
}

try {
  if (DIAG) { const ok = await diagnostico(); process.exitCode = ok ? 0 : 1; }
  else await publicarCola();
} catch (e) {
  console.error("Error:", limpiar(e.message));
  process.exitCode = 1;
}

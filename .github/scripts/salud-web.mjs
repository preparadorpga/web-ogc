// Estado público de organizacionygestioncomercial.es para la secretaria (así no necesita leer la web ella misma).
// SiteGround a veces responde 202 con un reto antibot (sgcaptcha) a los servidores de GitHub: eso NO es una caída,
// pero tampoco prueba que la web funcione. Se marca como «antibot» y se reintenta con cabeceras de navegador.
import { writeFileSync } from "node:fs";
const BASE = "https://organizacionygestioncomercial.es";
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "es-ES,es;q=0.9" };
const out = { fecha: new Date().toISOString(), paginas: {}, antibot: false, estado: "ok", errores: [] };
async function pedir(url) {
  for (let i = 0; i < 3; i++) {
    let r, t;
    try { r = await fetch(url, { redirect: "follow", headers: UA, signal: AbortSignal.timeout(30000) }); t = await r.text(); }
    catch (e) { if (i === 2) throw e; await new Promise((s) => setTimeout(s, 15000)); continue; }
    const reto = r.status === 202 || /sgcaptcha|sg-captcha|\.well-known\/sgcaptcha/i.test(t);
    if (!reto) return { status: r.status, texto: t };
    await new Promise((s) => setTimeout(s, 4000));
    if (i === 2) return { status: r.status, texto: t, reto: true };
  }
}
for (const p of ["/", "/tienda/", "/muestras-gratis/", "/convocatorias-ogc-por-comunidad/", "/blog/"]) {
  try { const r = await pedir(BASE + p); out.paginas[p] = r.reto ? "antibot" : r.status; if (r.reto) out.antibot = true; }
  catch (e) { out.paginas[p] = String(e.message || e); }
}
try {
  const r = await pedir(BASE + "/feed/");
  if (r.reto) { out.antibot = true; out.errores.push("feed: reto antibot de SiteGround (no es caída)"); }
  out.blog = [...r.texto.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g)].slice(0, 5)
    .map((m) => ({ titulo: m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim(), enlace: m[2].trim(), fecha: new Date(m[3]).toISOString() }));
} catch (e) { out.errores.push(`feed: ${e.message}`); }
const vals = Object.values(out.paginas);
if (vals.some((v) => typeof v === "number" && v >= 400) || vals.some((v) => typeof v === "string" && v !== "antibot")) out.estado = "caida";
else if (out.antibot) out.estado = "antibot";
out.nota = out.estado === "antibot" ? "SiteGround pide un reto antibot a GitHub. No es una caída, pero hoy no se ha podido comprobar el contenido. Si se repite varios días, desactivar la protección antibot para estas comprobaciones en SiteGround (Seguridad › Protección contra bots) o mirar la web con el navegador." : undefined;
writeFileSync("sync/redes/estado/web.json", JSON.stringify(out, null, 2) + "\n");
console.log(`Web: ${out.estado} ${JSON.stringify(out.paginas)} · último artículo: ${out.blog?.[0]?.fecha ?? "?"}`);

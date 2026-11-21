// Estado público de organizacionygestioncomercial.es para la secretaria (así no necesita leer la web ella misma).
import { writeFileSync } from "node:fs";
const BASE = "https://organizacionygestioncomercial.es";
const out = { fecha: new Date().toISOString(), paginas: {}, errores: [] };
for (const p of ["/", "/tienda/", "/muestras-gratis/", "/convocatorias-ogc-por-comunidad/", "/blog/"]) {
  try { const r = await fetch(BASE + p, { redirect: "follow" }); out.paginas[p] = r.status; } catch (e) { out.paginas[p] = String(e.message || e); }
}
try {
  const x = await (await fetch(BASE + "/feed/")).text();
  out.blog = [...x.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g)].slice(0, 5)
    .map((m) => ({ titulo: m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim(), enlace: m[2].trim(), fecha: new Date(m[3]).toISOString() }));
} catch (e) { out.errores.push(`feed: ${e.message}`); }
writeFileSync("sync/redes/estado/web.json", JSON.stringify(out, null, 2) + "\n");
console.log(`Web: ${JSON.stringify(out.paginas)} · último artículo: ${out.blog?.[0]?.fecha ?? "?"}`);

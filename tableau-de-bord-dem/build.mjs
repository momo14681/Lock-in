#!/usr/bin/env node
// Assemble le tableau de bord en un seul fichier HTML autonome (aucune ressource
// externe : la politique CSP du fichier interdit tout accès réseau).
//
//   node build.mjs            -> Tableau_de_bord_DEM.html
//
// Sources lisibles : src/template.html, src/styles.css, src/js/*.js (concaténés
// dans l'ordre alphabétique, partagent une même portée).
// Bibliothèques figées : vendor/ (SheetJS, pdf-lib, fontkit, police Work Sans).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const stripSourceMaps = (code) => code.replace(/^\/\/# sourceMappingURL=.*$/gm, "");

const appJs = readdirSync(join(root, "src", "js"))
  .filter((name) => name.endsWith(".js"))
  .sort()
  .map((name) => `// ---- ${name} ----\n${read("src", "js", name)}`)
  .join("\n");

const vendorJs = ["xlsx.full.min.js", "pdf-lib.min.js", "fontkit.min.js"]
  .map((name) => stripSourceMaps(read("vendor", name)))
  .join("\n;");

const parts = {
  FONT_FACE: read("vendor", "work-sans.css"),
  FONT_LICENSE: read("vendor", "work-sans-OFL.txt"),
  STYLES: read("src", "styles.css"),
  VENDOR_JS: vendorJs,
  PDF_FONTS: read("vendor", "pdf-fonts.js"),
  APP_JS: appJs,
};

for (const [name, content] of Object.entries(parts)) {
  if (/<\/script/i.test(content) || (name === "FONT_LICENSE" && content.includes("-->"))) {
    throw new Error(`${name} contient une séquence qui casserait le HTML.`);
  }
}

// Remplacement par fonction : les bibliothèques contiennent des motifs « $& ».
const html = read("src", "template.html").replace(/\/\*@@([A-Z_]+)@@\*\/|<!--@@([A-Z_]+)@@-->/g, (match, a, b) => {
  const key = a || b;
  if (!(key in parts)) throw new Error(`Marqueur inconnu : ${key}`);
  return parts[key];
});

const out = join(root, "Tableau_de_bord_DEM.html");
writeFileSync(out, html);
console.log(`${out} · ${(html.length / 1024 / 1024).toFixed(2)} Mo`);

#!/usr/bin/env node
// Assemble le tableau de bord en un seul fichier HTML autonome (aucune ressource
// externe : la politique CSP du fichier interdit tout accès réseau).
//
//   node build.mjs            -> Tableau_de_bord_DEM.html
//
// Sources lisibles : src/template.html, src/styles.css, src/js/*.js (concaténés
// dans l'ordre alphabétique, partagent une même portée).
// Bibliothèques figées : vendor/ (SheetJS, pdf-lib, fontkit, police Work Sans).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

// SheetJS dans sa propre balise <script id="xlsxLib"> : la page la réutilise pour lire
// le classeur dans un Worker, sans figer l'affichage.
const xlsxJs = stripSourceMaps(read("vendor", "xlsx.full.min.js"));
const vendorJs = ["pdf-lib.min.js", "fontkit.min.js"]
  .map((name) => stripSourceMaps(read("vendor", name)))
  .join("\n;");

const parts = {
  FONT_FACE: read("vendor", "work-sans.css"),
  FONT_LICENSE: read("vendor", "work-sans-OFL.txt"),
  STYLES: read("src", "styles.css"),
  XLSX_JS: xlsxJs,
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

// Police EDF 2020 : propriété d'EDF, jamais versionnée (dossier fonts-edf/ ignoré).
// Si elle est présente localement, une seconde version l'embarque pour un usage interne.
const edfDir = join(root, "fonts-edf");
const edfFaces = [["Light", 300], ["Regular", 400], ["Bold", 700]]
  .filter(([name]) => existsSync(join(edfDir, `EDF2020W01-${name}.woff2`)))
  .map(([name, weight]) => `@font-face{font-family:"EDF 2020";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(join(edfDir, `EDF2020W01-${name}.woff2`)).toString("base64")}) format("woff2");}`);
if (edfFaces.length) {
  const edfHtml = html.replace("<style>", "<style>" + edfFaces.join(""));
  const edfOut = join(root, "Tableau_de_bord_DEM_EDF.html");
  writeFileSync(edfOut, edfHtml);
  console.log(`${edfOut} · police EDF 2020 embarquée (usage interne, non versionné)`);
}

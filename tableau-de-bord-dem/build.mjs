#!/usr/bin/env node
// Assemble le tableau de bord en un seul fichier HTML autonome (aucune ressource
// externe : la politique CSP du fichier interdit tout accès réseau).
//
//   node build.mjs            -> Tableau_de_bord_DEM.html
//                                 addin/index.html + addin/manifest.xml (complément Excel)
//   ADDIN_URL=https://…/ node build.mjs   adresse où addin/ est publié (pour le manifeste)
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

// Complément Excel : même page, avec office.js chargé depuis Microsoft ; la page lit et écrit
// alors la DEM ouverte. La politique « aucun accès réseau » du fichier autonome est retirée :
// office.js charge lui-même d'autres scripts Microsoft. Toujours en police Work Sans :
// addin/ est publié sur une adresse web.
const csp = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
if (!csp.test(html)) throw new Error("Politique de sécurité introuvable dans le modèle.");
// Page publique : sans l'adresse des outils internes (liens EAM / eDRT masqués).
const tools = 'const EDF_TOOLS = "https://prod-sdin.edf.fr";';
if (!html.includes(tools)) throw new Error("Adresse des outils EDF introuvable.");
const addinHtml = html.replace(csp, () => `<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>`).replace(tools, 'const EDF_TOOLS = "";');
if (/prod-sdin|edf\.fr/i.test(addinHtml)) throw new Error("La page du complément contient encore une adresse interne EDF.");
const addinUrl = (process.env.ADDIN_URL || "https://melk735.github.io/Pilotage-essais/").replace(/\/?$/, "/");
writeFileSync(join(root, "addin", "index.html"), addinHtml);
writeFileSync(join(root, "addin", "manifest.xml"), read("src", "addin", "manifest.xml").replaceAll("{{URL}}", addinUrl));
console.log(`addin/index.html + addin/manifest.xml · ${addinUrl}`);

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

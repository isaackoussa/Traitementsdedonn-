// Copie les fichiers publics du site dans dist/ (publié par Netlify ; les fonctions restent dans netlify/functions).
import { cpSync, mkdirSync, rmSync } from "node:fs";

const FILES = ["index.html", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "css", "js", "vendor"];
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
for (const f of FILES) cpSync(f, `dist/${f}`, { recursive: true });
console.log(`dist/ prêt (${FILES.length} éléments)`);

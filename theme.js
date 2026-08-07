// theme.js — tema claro/escuro compartilhado pelo visualizador e pelo upload.
//
// Escuro é o padrão do produto: o modelo 3D é o palco e o cromo desaparece.
// A preferência vive numa única chave de localStorage, então o clínico que
// muda o tema no upload encontra o visualizador do mesmo jeito.
//
// A pintura inicial NÃO acontece aqui: cada página escreve data-theme num
// script inline no <head>, antes do primeiro frame. Este módulo cuida da
// troca em runtime e avisa quem precisa reagir (o Three.js não enxerga
// variáveis CSS: world.js lê --w-canvas-bg via o listener abaixo).

export const THEME_STORAGE_KEY = "medcase-viewer-theme";

const listeners = new Set();

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function setTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  // A troca de ícone (sol ↔ lua) é puro CSS, chaveada em html[data-theme].
  for (const fn of listeners) fn(next);
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch (_) { /* storage bloqueado */ }
}

// Aplica o tema salvo (sem persistir de novo) e dispara os listeners — é o
// que dá ao mundo 3D a cor de fundo correta na primeira montagem.
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_STORAGE_KEY); } catch (_) { /* idem */ }
  setTheme(saved === "light" ? "light" : "dark");
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

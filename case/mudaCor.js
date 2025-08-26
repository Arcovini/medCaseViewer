var blackMode = true;
var whiteMode = false;

document.addEventListener("DOMContentLoaded", function () {
  const btnblack = document.getElementById("bg-black");
  const icon = document.getElementById("icon");
  const med = document.getElementById("newMeasure");
  const vid = document.getElementById("global_trigger");
  const struct = document.getElementById("structures");
  const title = document.getElementById("title");
  const nav = document.getElementById("sub");
  const imgMed = document.getElementById("imggMedir");

  function changeBackground(color) {
    const mainDiv = document.querySelector(".min-height-90vh");
    if (mainDiv) {
      mainDiv.style.setProperty("background-color", color, "important");
    } else {
      document.body.style.setProperty("background-color", color, "important");
    }
  }

  // --- ajuda: pega o elemento que define o fundo principal
  function getBgElement() {
    return document.querySelector(".min-height-90vh") || document.body;
  }

  // --- ajuda: converte "rgb/rgba(#...)" em [r,g,b]
  function parseRGB(str) {
    if (!str) return [39, 36, 37]; // fallback #272425
    if (str.startsWith("#")) {
      let c = str.slice(1);
      if (c.length === 3) c = c.split("").map(x => x + x).join("");
      const r = parseInt(c.slice(0, 2), 16);
      const g = parseInt(c.slice(2, 4), 16);
      const b = parseInt(c.slice(4, 6), 16);
      return [r, g, b];
    }
    const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
    return [39, 36, 37];
  }

  // --- luminância relativa sRGB para decidir claro/escuro
  function relLuma([r, g, b]) {
    const toLin = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const R = toLin(r), G = toLin(g), B = toLin(b);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  // --- retorna true se o fundo atual é escuro
  function bgIsDark() {
    const el = getBgElement();
    const bg = getComputedStyle(el).backgroundColor || el.style.backgroundColor;
    const lum = relLuma(parseRGB(bg));
    return lum < 0.5;
  }

  // Define a cor (invert(1) = claro sobre fundo escuro, invert(0) = escuro sobre fundo claro)
  function setIconColor(imgEl, wantLight) {
    if (!imgEl) return;
    imgEl.style.filter = wantLight ? "invert(1)" : "invert(0)";
  }

  // Busca todos os ícones de olho (eye_icon.svg, eye_off_icon.svg, e #imggEye se existir)
  function getEyeIcons() {
    const list = [];
    const byId = document.getElementById("imggEye");
    if (byId) list.push(byId);
    document
      .querySelectorAll('img[src*="eye_icon.svg"], img[src*="eye_off_icon.svg"]')
      .forEach((el) => list.push(el));
    return list;
  }

  // --- mantém os olhos sempre invertidos ao fundo atual
  function syncEyeIconsToBackground() {
    const isDark = bgIsDark();
    // no fundo escuro queremos ícone claro (invert(1)); no claro, ícone escuro (invert(0))
    getEyeIcons().forEach((el) => setIconColor(el, isDark));
    // o ícone do botão Medir você já tratava separado; mantemos a lógica:
    setIconColor(imgMed, !bgIsDark()); // se fundo escuro, medir fica escuro? ajuste se quiser
  }

  function applyTheme(isDark) {
    if (isDark) {
      // ==== MODO ESCURO ====
      changeBackground("#2f3136");
      document.getElementById("logo").style.backgroundColor = "#2f3136";
      document.getElementById("overtop").style.backgroundColor = "#2f3136";
      document.getElementById("overbottom").style.backgroundColor = "#2f3136";
      document.getElementById("top").style.backgroundColor = "#2f3136";

      icon.src = "lua.png";
      icon.alt = "modo claro";
      icon.backgroundColor = "#2f3136";
      if (btnblack) btnblack.style.backgroundColor = "#2f3136";

      if (med) { med.style.color = "#e7eaf1"; med.style.backgroundColor = "#3b3939"; }
      if (vid) { vid.style.color = "#e7eaf1"; vid.style.backgroundColor = "#3b3939"; }
      if (struct) { struct.style.color = "#e7eaf1"; struct.style.backgroundColor = "#3b3939"; }
      if (title)  { title.style.color  = "#e7eaf1"; title.style.backgroundColor  = "#3b3939"; }
      if (nav)    { nav.style.color    = "#e7eaf1"; nav.style.backgroundColor    = "#3b3939"; }

      blackMode = true;
      whiteMode = false;
    } else {
      // ==== MODO CLARO ====
      changeBackground("#f3f5f9");
      document.getElementById("logo").style.backgroundColor = "#f3f5f9";
      document.getElementById("overtop").style.backgroundColor = "#f3f5f9";
      document.getElementById("overbottom").style.backgroundColor = "#f3f5f9";
      document.getElementById("top").style.backgroundColor = "#f3f5f9";

      icon.src = "sol.png";
      icon.alt = "modo escuro";
      icon.backgroundColor = "#f3f5f9";
      if (btnblack) btnblack.style.backgroundColor = "#f3f5f9";

      if (med) { med.style.color = "#2b2e34"; med.style.backgroundColor = "#cfd3dc"; }
      if (vid) { vid.style.color = "#2b2e34"; vid.style.backgroundColor = "#cfd3dc"; }
      if (struct) { struct.style.color = "#2b2e34"; struct.style.backgroundColor = "#e7eaf1"; }
      if (title)  { title.style.color  = "#2b2e34"; title.style.backgroundColor  = "#e7eaf1"; }
      if (nav)    { nav.style.color    = "#2b2e34"; nav.style.backgroundColor    = "#e7eaf1"; }

      blackMode = false;
      whiteMode = true;
    }

    // após aplicar tema, garante ícones ajustados ao fundo real
    syncEyeIconsToBackground();
  }

  // ---- Observa mudanças de fundo feitas por QUALQUER código
  function observeBackgroundChanges() {
    const target = getBgElement();
    if (!target) return;

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && (m.attributeName === "style" || m.attributeName === "class")) {
          // sempre que o estilo/classe do container mudar, re-sincroniza os olhos
          syncEyeIconsToBackground();
        }
      }
    });

    mo.observe(target, { attributes: true, attributeFilter: ["style", "class"] });

    // fallback: também observa o body caso mude por ele
    if (target !== document.body) {
      const moBody = new MutationObserver(() => syncEyeIconsToBackground());
      moBody.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
    }
  }

  // ---- Estado inicial
  applyTheme(blackMode);
  observeBackgroundChanges();

  // Reaplica inversão quando novos olhos entrarem no DOM (ex.: lista/árvore dinâmica)
  const moAll = new MutationObserver(() => syncEyeIconsToBackground());
  moAll.observe(document.documentElement, { childList: true, subtree: true });

  // Toggle do botão
  if (btnblack) {
    btnblack.addEventListener("click", function () {
      if (whiteMode === true) {
        applyTheme(true);  // vai para escuro
      } else if (blackMode === true) {
        applyTheme(false); // vai para claro
      } else {
        // se por algum motivo os flags perderem o estado, decide pelo fundo real
        applyTheme(!bgIsDark());
      }
    });
  }
});

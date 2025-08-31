// main.js (versão YouTube)
// Substitui o viewer do Sketchfab por um iframe do YouTube
// e exibe o vídeo apenas quando o botão "VIDEO" é clicado.

(function () {
  // 🔹 1) ID padrão do vídeo
  const DEFAULT_YT_ID = "seOJbR21Pqc"; // <-- só o ID puro, sem "?si="

  // 🔹 2) Garante que a URL sempre tenha "?yt=..."
  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.get("yt")) {
    urlParams.set("yt", DEFAULT_YT_ID);
    const newUrl = window.location.pathname + "?" + urlParams.toString();
    window.history.replaceState({}, "", newUrl);
  }

  // 🔹 3) Pega o ID de ?yt=...
  const videoId = urlParams.get("yt") || DEFAULT_YT_ID;

  // 🔹 4) Utilitário para subir ancestrais até o <body>
  function getAncestorsUntilBody(el) {
    const list = [];
    let cur = el?.parentElement || null;
    while (cur && cur !== document.body) {
      list.push(cur);
      cur = cur.parentElement;
    }
    if (cur === document.body) list.push(document.body);
    return list;
  }

  // 🔹 5) Estados para esconder/restaurar elementos
  const originalDisplays = new Map();
  let hiddenElements = [];

  // 🔹 6) Cria o iframe do YouTube (inicialmente escondido) e o botão
  function setupYouTubeAndButton() {
    // Cria iframe YouTube
    const yt = document.createElement("iframe");
    yt.id = "video";
    yt.src = "https://www.youtube.com/embed/" + videoId; // ✅ link fixo até /embed/, só o ID varia
    yt.setAttribute("frameborder", "0");
    yt.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
    yt.setAttribute("allowfullscreen", "true");
    yt.style.display = "none"; // começa invisível
    document.body.appendChild(yt);

    // Cria botão "VIDEO"
    const btn = document.createElement("button");
    btn.id = "global_trigger";
    btn.dataset.isHidden = "false"; // "false" = não estamos no modo vídeo ainda
    btn.textContent = "VIDEO";
    Object.assign(btn.style, {
      position: "fixed",
      top: "5px",
      left: "110px",
      zIndex: "2147483647",
      padding: "10px 20px",
      backgroundColor: "rgb(59, 57, 57)",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "16px",
    });
    document.body.appendChild(btn);

    // Clique do botão alterna o "Modo Vídeo"
    btn.addEventListener("click", function () {
      const enteringVideoMode = this.dataset.isHidden === "false";

      if (enteringVideoMode) {
        // Manter visíveis: o botão, o vídeo e os ancestrais do vídeo
        const keepSet = new Set([btn, yt, ...getAncestorsUntilBody(yt)]);
        hiddenElements = [];

        // Esconde tudo que não for mantido
        document.querySelectorAll("*").forEach((el) => {
          if (el === document.documentElement || el === document.body) return;
          if (!keepSet.has(el)) {
            if (!originalDisplays.has(el)) {
              originalDisplays.set(el, el.style.display);
            }
            el.style.display = "none";
            hiddenElements.push(el);
          }
        });

        // Ajusta o iframe para ocupar a tela de forma confortável
        yt.style.position = "fixed";
        yt.style.inset = "60px 20px 20px 20px"; // margem superior p/ não cobrir o botão
        yt.style.width = "calc(100% - 40px)";
        yt.style.height = "calc(100% - 80px)";
        yt.style.zIndex = "2147483646";
        yt.style.background = "#000";
        yt.style.display = "block"; // aparece somente agora

        this.dataset.isHidden = "true";
        this.textContent = "SAIR DO VÍDEO";
      } else {
        // Sair do modo vídeo: restaura elementos escondidos
        hiddenElements.forEach((el) => {
          const prev = originalDisplays.get(el);
          el.style.display = prev !== undefined ? prev : "";
        });
        hiddenElements = [];

        // Vídeo volta a ficar invisível no estado normal
        yt.style.display = "none";
        yt.style.position = "";
        yt.style.inset = "";
        yt.style.width = "";
        yt.style.height = "";
        yt.style.zIndex = "";
        yt.style.background = "";

        this.dataset.isHidden = "false";
        this.textContent = "VIDEO";
      }
    });
  }

  // 🔹 7) Inicializa quando o DOM estiver pronto
  document.addEventListener("DOMContentLoaded", setupYouTubeAndButton);
})();

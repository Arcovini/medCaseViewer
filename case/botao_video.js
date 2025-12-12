// botao_video.js - Simplified version (only functionality)
(function () {
  // 1) Get video ID from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get("yt");

  // 2) If no video ID, hide the button and exit
  if (!videoId) {
    const btn = document.getElementById("global_trigger");
    if (btn) {
      btn.style.display = "none";
    }
    return; // Exit early - no video functionality needed
  }

  // 3) Utilitário para subir ancestrais até o <body>
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

  // 4) Estados para esconder/restaurar elementos
  const originalDisplays = new Map();
  let hiddenElements = [];

  // 5) Setup do YouTube e funcionalidade do botão
  function setupYouTube() {
    // Pega o botão que já existe no HTML
    const btn = document.getElementById("global_trigger");
    if (!btn) {
      console.error("Botão VIDEO não encontrado!");
      return;
    }

    // Make sure button is visible since we have a video ID
    btn.style.display = "block";

    // Cria iframe YouTube (inicialmente escondido)
    const yt = document.createElement("iframe");
    yt.id = "video";
    yt.src = "https://www.youtube.com/embed/" + videoId;
    yt.setAttribute("frameborder", "0");
    yt.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    );
    yt.setAttribute("allowfullscreen", "true");
    yt.style.display = "none";
    document.body.appendChild(yt);

    // Clique do botão alterna o "Modo Vídeo"
    btn.addEventListener("click", function () {
      const enteringVideoMode = this.dataset.isHidden === "false";

      if (enteringVideoMode) {
        // Include button's ancestors too
        const keepSet = new Set([
          btn,
          yt,
          ...getAncestorsUntilBody(btn),
          ...getAncestorsUntilBody(yt),
        ]);
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

        // Ajusta o iframe para ocupar a tela
        yt.style.position = "fixed";
        yt.style.inset = "60px 20px 20px 20px";
        yt.style.width = "calc(100% - 40px)";
        yt.style.height = "calc(100% - 80px)";
        yt.style.zIndex = "2147483646";
        yt.style.background = "#000";
        yt.style.display = "block";

        this.dataset.isHidden = "true";
        this.textContent = "Voltar";
      } else {
        // Sair do modo vídeo: restaura elementos
        hiddenElements.forEach((el) => {
          const prev = originalDisplays.get(el);
          el.style.display = prev !== undefined ? prev : "";
        });
        hiddenElements = [];

        // Vídeo volta a ficar invisível
        yt.style.display = "none";
        yt.style.position = "";
        yt.style.inset = "";
        yt.style.width = "";
        yt.style.height = "";
        yt.style.zIndex = "";
        yt.style.background = "";

        this.dataset.isHidden = "false";
        this.textContent = "Vídeo";
      }
    });
  }

  // 6) Inicializa quando o DOM estiver pronto
  document.addEventListener("DOMContentLoaded", setupYouTube);
})();

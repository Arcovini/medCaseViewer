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

  function changeBackground(color) {
    const mainDiv = document.querySelector(".min-height-90vh");
    if (mainDiv) {
      mainDiv.style.setProperty("background-color", color, "important");
    } else {
      document.body.style.setProperty("background-color", color, "important");
    }
  }

  btnblack.addEventListener("click", function () {
    if (whiteMode === true) {
      // ==== MODO ESCURO (igual ao 1º print) ====
      // página
      changeBackground("#2f3136");
      document.getElementById("logo").style.backgroundColor = "#2f3136";
      document.getElementById("overtop").style.backgroundColor = "#2f3136";
      document.getElementById("overbottom").style.backgroundColor = "#2f3136";
      document.getElementById("top").style.backgroundColor = "#2f3136";

      whiteMode = false;
      blackMode = true;

      // ícone e botão de modo
      icon.src = "lua.png";
      icon.alt = "modo claro";
      icon.backgroundColor = "#2f3136";
      btnblack.style.backgroundColor = "#2f3136";

      // botões (chip escuro)
      if (med) { med.style.color = "#e7eaf1"; med.style.backgroundColor = "#3b3939"; }
      if (vid) { vid.style.color = "#e7eaf1"; vid.style.backgroundColor = "#3b3939"; }

      // painel/estruturas/títulos (card grafite)
      if (struct) { struct.style.color = "#e7eaf1"; struct.style.backgroundColor = "#3b3939"; }
      if (title)  { title.style.color  = "#e7eaf1"; title.style.backgroundColor  = "#3b3939"; }
      if (nav)    { nav.style.color    = "#e7eaf1"; nav.style.backgroundColor    = "#3b3939"; }
    } 
    else if (blackMode === true) {
      // ==== MODO CLARO (igual ao 2º print) ====
      // página
      changeBackground("#f3f5f9");
      document.getElementById("logo").style.backgroundColor = "#f3f5f9";
      document.getElementById("overtop").style.backgroundColor = "#f3f5f9";
      document.getElementById("overbottom").style.backgroundColor = "#f3f5f9";
      document.getElementById("top").style.backgroundColor = "#f3f5f9";

      blackMode = false;
      whiteMode = true;

      // ícone e botão de modo
      icon.src = "sol.png";
      icon.alt = "modo escuro";
      icon.backgroundColor = "#f3f5f9";
      btnblack.style.backgroundColor = "#f3f5f9";

      // botões (chip claro)
      if (med) { med.style.color = "#2b2e34"; med.style.backgroundColor = "#cfd3dc"; }
      if (vid) { vid.style.color = "#2b2e34"; vid.style.backgroundColor = "#cfd3dc"; }

      // painel/estruturas/títulos (card cinza-claro)
      if (struct) { struct.style.color = "#2b2e34"; struct.style.backgroundColor = "#e7eaf1"; }
      if (title)  { title.style.color  = "#2b2e34"; title.style.backgroundColor  = "#e7eaf1"; }
      if (nav)    { nav.style.color    = "#2b2e34"; nav.style.backgroundColor    = "#e7eaf1"; }
    }
  });
});

function isMobileDevice() {
  return /Mobi|Android/i.test(navigator.userAgent);
}

function isIPad() {
  return (
    /iPad/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && "ontouchend" in document)
  );
}
var isMeasuring = false;

const newMeasure = document.getElementById("newMeasure");

newMeasure.addEventListener("click", function () {
  console.log("Toggle button clicked");
  isMeasuring = !isMeasuring;
  // Add this block:
  if (isMeasuring) {
    newMeasure.classList.add("measure-mode-active");
  } else {
    newMeasure.classList.remove("measure-mode-active");
  }

  if (isMeasuring === true) {
    console.log("measure button is true");

    // Cria measureModal informativo
    let measureModal = document.getElementById("measureModal");
    if (!measureModal) {
      measureModal = document.createElement("p");
      measureModal.id = "measureModal";
      // measureModal.style.position = "fixed";
      // if (isMobileDevice()) {
      //   measureModal.style.top = "80px";
      //   measureModal.width = "auto";
      // } else {
      //   measureModal.style.top = "20px";
      //   measureModal.style.left = "250px";
      // }
      // measureModal.style.backgroundColor = "white";
      // measureModal.style.padding = "10px";
      // measureModal.style.opacity = "70%";
      // measureModal.style.borderRadius = "24px";
      // measureModal.style.fontSize = isMobileDevice() ? "16px" : "14px";
      // measureModal.style.zIndex = "1000";
      // document.body.appendChild(measureModal);
      const skfbView = document.querySelector(".skfb-view");
      if (skfbView) {
        skfbView.appendChild(measureModal);
      }
    }
    measureModal.innerHTML = "Toque em dois pontos no modelo para medir";

    // Cria SVG para desenhar a linha
    let svgEl = document.getElementById("svgCanvas");
    if (!svgEl) {
      svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgEl.id = "svgCanvas";
      svgEl.setAttribute("width", window.innerWidth);
      svgEl.setAttribute("height", window.innerHeight);
      svgEl.style.position = "fixed";
      svgEl.style.top = "0";
      svgEl.style.left = "0";
      svgEl.style.pointerEvents = "none";
      svgEl.style.zIndex = "1000";
      document.body.appendChild(svgEl);
    }

    function updateSVGCanvasSize() {
      const iframe = document.querySelector("iframe"); // Selecione o iframe do Sketchfab
      const svgEl = document.getElementById("svgCanvas");

      if (iframe && svgEl) {
        const rect = iframe.getBoundingClientRect();

        svgEl.style.position = "absolute";
        svgEl.style.top = rect.top + window.scrollY + "px";
        svgEl.style.left = rect.left + window.scrollX + "px";
        svgEl.setAttribute("width", rect.width);
        svgEl.setAttribute("height", rect.height);
      }
    }
    updateSVGCanvasSize();

    window.addEventListener("resize", updateSVGCanvasSize);

    setupClickEventHandler();
  } else {
    console.log("measure button is false");

    // Limpa tudo se for desativado
    const svgEl = document.getElementById("svgCanvas");
    if (svgEl) svgEl.remove();

    const measureModal = document.getElementById("measureModal");
    if (measureModal) measureModal.remove();

    const resetBtn = document.getElementById("resetCoords");
    if (resetBtn) resetBtn.remove();
    if (typeof cameraCheckInterval !== "undefined") {
      clearInterval(cameraCheckInterval);
    }
  }
});

function setupClickEventHandler() {
  let oldX = null,
    oldY = null,
    oldZ = null;
  let endX, endY, endZ;

  api.addEventListener(
    "click",
    function (info) {
      if (info.position3D) {
        const x = parseFloat(info.position3D[0].toFixed(3));
        const y = parseFloat(info.position3D[1].toFixed(3));
        const z = parseFloat(info.position3D[2].toFixed(3));
        const startX = parseFloat(info.position2D[0].toFixed(3));
        const startY = parseFloat(info.position2D[1].toFixed(3));

        const svgEl = document.getElementById("svgCanvas");
        const measureModal = document.getElementById("measureModal");

        let lineEl = document.getElementById("line");
        if (!lineEl) {
          lineEl = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line"
          );
          lineEl.id = "line";
          if (isIPad()) {
            lineEl.setAttribute("stroke", "green");
          } else {
            lineEl.setAttribute("stroke", isMobileDevice() ? "blue" : "red");
            lineEl.setAttribute("stroke-width", isMobileDevice() ? "4" : "2");
            svgEl.appendChild(lineEl);
          }
        }

        if (oldX === null && oldY === null && oldZ === null) {
          measureModal.innerHTML =
            "Primeiro clique registrado! Selecione outro ponto. Lembre de não mexer a câmera.";
          oldX = startX;
          oldY = startY;
          endX = x;
          endY = y;
          endZ = z;
        } else {
          const deltaX = x - endX;
          const deltaY = y - endY;
          const deltaZ = z - endZ;
          const distancia = Math.sqrt(
            deltaX ** 2 + deltaY ** 2 + deltaZ ** 2
          ).toFixed(3);
          if (isMobileDevice()) {
            measureModal.innerHTML =
              "Distância calculada: " + distancia + " milímetros";
            lineEl.setAttribute("x1", oldX);
            lineEl.setAttribute("y1", oldY);
            lineEl.setAttribute("x2", startX);
            lineEl.setAttribute("y2", startY);
            lineEl.setAttribute("visibility", "visible");

            oldX = null;
            oldY = null;
          } else if (isIPad()) {
            measureModal.innerHTML =
              "Distância calculada: " + distancia + " milímetros";
            lineEl.setAttribute("x1", oldX);
            lineEl.setAttribute("y1", oldY);
            lineEl.setAttribute("x2", startX);
            lineEl.setAttribute("y2", startY);
            lineEl.setAttribute("visibility", "visible");

            oldX = null;
            oldY = null;
          } else {
            measureModal.innerHTML =
              "Distância calculada: " + distancia + " milímetros";
            lineEl.setAttribute("x1", oldX);
            lineEl.setAttribute("y1", oldY);
            lineEl.setAttribute("x2", startX);
            lineEl.setAttribute("y2", startY);
            lineEl.setAttribute("visibility", "visible");

            oldX = null;
            oldY = null;
          }
        }

        console.log("Clique em: X=" + x + ", Y=" + y + ", Z=" + z);
      }
      let lastCameraPosition = null;
      let cameraCheckInterval = null;

      function startCameraMonitor() {
        api.getCameraLookAt(function (err, camera) {
          if (!err) {
            lastCameraPosition = JSON.stringify(camera);
          }
        });

        cameraCheckInterval = setInterval(() => {
          api.getCameraLookAt(function (err, camera) {
            if (err || !lastCameraPosition) return;

            const currentPos = JSON.stringify(camera);
            if (currentPos !== lastCameraPosition) {
              console.log("Câmera foi movida! Removendo Medidas.");

              const lineEl = document.getElementById("line");
              if (lineEl) lineEl.remove();

              isMeasuring = false;
              newMeasure.classList.remove("measure-mode-active");

              const svgEl = document.getElementById("svgCanvas");
              if (svgEl) svgEl.remove();

              const measureModal = document.getElementById("measureModal");
              if (measureModal) measureModal.remove();

              const resetBtn = document.getElementById("resetCoords");
              if (resetBtn) resetBtn.remove();

              if (typeof cameraCheckInterval !== "undefined") {
                clearInterval(cameraCheckInterval);
              }

              oldX = null;
              oldY = null;
              oldZ = null;

              lastCameraPosition = currentPos; // atualiza posição para não repetir
            }
          });
        }, 500); // verifica a cada 0.5 segundos
      }

      startCameraMonitor();
    },
    { pick: "fast" }
  );
}

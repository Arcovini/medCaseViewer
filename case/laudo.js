// sliders.js
function createOpacitySlider(initialValue, materialIndex) {
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = initialValue;
    slider.className = "opacity-slider";
    slider.style.marginLeft = "10px";
    slider.title = "Adjust Opacity";

  }
  
  // Deixe a função visível globalmente se estiver usando um <script> tag
  window.createOpacitySlider = createOpacitySlider;

  function createToggleButton(btnType, instance, name) {
    const btn = document.createElement("button");
    btn.className = btnType;
    btn.id = instance + "_" + name + "_toggle";
    btn.value = instance;
    btn.dataset.isHidden = "false";
    btn.innerHTML = `<img src="eye_icon.svg" width="24" alt="Hide" />`;
    return btn;
  }
  

function addToggleButton(){
    var toggleButtons = document.getElementsByClassName("Toggle");
        for (let i = 0; i < toggleButtons.length; i++) {
          toggleButtons[i].addEventListener("click", function () {
            if (this.dataset.isHidden === "false") {
              api.hide(this.value);
              this.dataset.isHidden = "true";
              this.innerHTML = `<img src="eye_off_icon.svg" width="24" alt="Show" />`;
            } else {
              api.show(this.value);
              this.dataset.isHidden = "false";
              this.innerHTML = `<img src="eye_icon.svg" width="24" alt="Hide" />`;
              const parentEl = document.getElementById(this.value);
              if (parentEl) {
                const childToggles = parentEl.getElementsByClassName("Toggle");
                for (let j = 0; j < childToggles.length; j++) {
                  api.show(childToggles[j].value);
                  childToggles[j].dataset.isHidden = "false";
                  childToggles[
                    j
                  ].innerHTML = `<img src="eye_icon.svg" width="24" alt="Hide" />`;
                }
              }
            }
          });
        }
}

function createOpacitySlider(opacity, materialIndex) {
    // function createOpacitySlider(opacity, materialIndex) {
    const slider = document.createElement("input");
    slider.className = "opacitySlider";
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = opacity.toString();
    slider.addEventListener("input", function () {
      setOpacityForMaterial(materialIndex, parseFloat(this.value));
    });
    return slider;
  }

  // Set opacity for a specific material

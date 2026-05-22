// main.js
// Sketchfab Viewer API: Start/Stop the viewer
var version = "1.12.0";
var api;
// Global arrays for materials and non-parent nodes
var materials = [];
var nonParentNodes = [];

// Global object to track nodes already added
var seenNodes = {};

var urlParams = new URLSearchParams(window.location.search);
var autoSpin = parseFloat(urlParams.get("autospin")) || 0.0;
var uid = urlParams.get("id") || "00aef10392ad46108b47663667544ec2";
const API_TOKEN = 'ab5b84fd10044d7e9a172fc8748100c9';  // Coloque seu token entre aspas
const MODEL_UID = '00aef10392ad46108b47663667544ec2';  // Coloque seu UID entre aspas
var iframe = document.getElementById("api-frame");
var client = new window.Sketchfab(version, iframe);

var error = function () {
  console.error("Sketchfab API error");
};

var myNodesByNameFromMap = {};

var success = function (passedApi) {
  api = passedApi; // Assign the API instance to the global variable
  api.start(function () {
    api.addEventListener("viewerready", function () {
      // Retrieve and store all materials without sorting
      api.getMaterialList(function (err, mats) {
        if (!err && mats.length > 0) {
          materials = mats;
          // Assign an index property to each material based on original order
          for (var i = 0; i < materials.length; i++) {
            materials[i].index = i;
          }
          console.log("Materials (original order):");
          materials.forEach(function (mat) {
            console.log("Material index:", mat.index, "Name:", mat.name);
          });
        }
      });

      api.getNodeMap(function (err, nodes) {
        if (!err) {
          // Build the node map using node names
          for (var instanceID in nodes) {
            var node = nodes[instanceID];
            var name = node.name || "noname_" + instanceID;
            myNodesByNameFromMap[name] = node;
          }

          console.log("Node map:", nodes);

          // Or enumerate each node’s properties:
          Object.keys(nodes).forEach(function (nodeID) {
            var node = nodes[nodeID];
            console.log("Node ID:", nodeID, "Name:", node.name);
            console.log(node);
          });

          // Identify the root node
          var rootNodeTree =
            myNodesByNameFromMap["RootNode"] || myNodesByNameFromMap["root"];
          if (rootNodeTree) {
            // Recursively build the nonParentNodes array
            recurse(rootNodeTree);
            console.log("nonParentNodes (with instanceIDs):");
            // Assign material indices based on node order
            nonParentNodes.forEach(function (node, index) {
              node.materialIndex = index % materials.length;
            });
            generateFlatList();
          }
        }
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
      });
      var oldX = null, oldY = null, oldZ = null;


// Cria o botão de reset apenas uma vez
function createResetButton(btnType) {
    if (document.getElementById("resetCoords")) return; // Evita criar múltiplos botões

    const reset = document.createElement("button"); 
    reset.className = btnType;
    reset.id = "resetCoords";
    reset.textContent = "Reset"; 

    reset.style.position = "fixed"; 
    reset.style.bottom = "20px";
    reset.style.left = "20px";
    reset.style.padding = "10px 20px";
    reset.style.backgroundColor = "white";
    reset.style.color = "black";
    reset.style.border = "none";
    reset.style.cursor = "pointer";
    reset.style.zIndex = "1000"; 
    document.body.appendChild(reset); 
}

document.getElementById("resetCoords").addEventListener("click", function () {
  oldX = null;
  oldY = null;
  oldZ = null;

  // Remove a linha do SVG se existir
  var lineEl = document.getElementById("line");
  if (lineEl) {
      lineEl.remove();
  }

  // Limpa o texto
  var textoEl = document.getElementById("texto");
  if (textoEl) {
      textoEl.innerHTML = "Clique para selecionar o primeiro ponto.";
  }

  console.log("Coordenadas resetadas!");
});

// Cria o botão de reset ao carregar a página
document.addEventListener("DOMContentLoaded", function () {
    createResetButton("meu-botao");
});
// Verifica se o elemento de texto existe, se não, cria e adiciona ao body
var textoEl = document.getElementById("texto");
if (!textoEl) {
  textoEl = document.createElement("p");
  textoEl.id = "texto";
  textoEl.style.position = "absolute";
  textoEl.style.top = "15px";
  textoEl.style.left = "300px";
  textoEl.style.color = "#fff"; // Texto mais claro
  textoEl.style.fontSize = "20px";
  textoEl.style.fontFamily = "Arial, sans-serif, bold";
  textoEl.style.backgroundColor = "#272425"; // Fundo semi-transparente
  textoEl.style.padding = "8px";
  textoEl.style.border = "1px solid #ccc";
  textoEl.style.borderRadius = "5px"; // Bordas arredondadas
  document.body.appendChild(textoEl);
  textoEl.innerHTML = "clique para registrar o primeiro ponto de medida.<br>Ao medir não mexa na camera para criar uma linha entre os pontos";
}

// Verifica se o SVG e a linha já existem, se não, cria e adiciona ao body
var svgEl = document.getElementById("svgCanvas");
if (!svgEl) {
    svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.id = "svgCanvas";
    svgEl.setAttribute("width", window.innerWidth);
    svgEl.setAttribute("height", window.innerHeight);
    svgEl.style.position = "fixed";
    svgEl.style.top = "085";
    svgEl.style.left = "020";
    svgEl.style.pointerEvents = "none";
    svgEl.style.zIndex = "1000";
    document.body.appendChild(svgEl);
}

api.addEventListener('modelInfo', function(info){
  console.log('Model description: ',info.description);
})

api.getModelInfo(function(err, info) {
            if (!err) {
                console.log('Model description:', info.description);
            }
        });

api.addEventListener('click', function(info) {
  if (info.position3D) {
      var x = parseFloat(info.position3D[0].toFixed(3));
      var y = parseFloat(info.position3D[1].toFixed(3));
      var z = parseFloat(info.position3D[2].toFixed(3));

      var startX = parseFloat(info.position2D[0].toFixed(3));
      var startY = parseFloat(info.position2D[1].toFixed(3));

      var lineEl = document.getElementById("line");
      if (!lineEl) {
          lineEl = document.createElementNS("http://www.w3.org/2000/svg", "line");
          lineEl.id = "line";
          lineEl.setAttribute("stroke", "red");
          lineEl.setAttribute("stroke-width", "2");
          svgEl.appendChild(lineEl);
      }

      if (oldX === null && oldY === null && oldZ === null) {
          textoEl.innerHTML = "Primeiro clique registrado! Selecione outro ponto. Lembre de não mexer a câmera.";
          oldX = startX;
          oldY = startY;
          endX = x;
          endY = y;
          endZ = z;
      } else {
          // Calcula a distância entre os dois pontos
          var deltaX = x - endX;
          var deltaY = y - endY;
          var deltaZ = z - endZ;
          var distancia = (Math.sqrt(deltaX ** 2 + deltaY ** 2 + deltaZ ** 2)).toFixed(3);

          textoEl.innerHTML = "Distância calculada: " + distancia + " milímetros";

          // Atualiza a linha SVG para conectar os pontos
          lineEl.setAttribute("x1", oldX);
          lineEl.setAttribute("y1", oldY);
          lineEl.setAttribute("x2", startX);
          lineEl.setAttribute("y2", startY);
          lineEl.setAttribute("visibility", "visible");

          // Reseta para novo clique
          oldX = null;
          oldY = null;
      }

      console.log("Clique em: X=" + x + ", Y=" + y + ", Z=" + z);
  }
}, { pick: 'fast' });

    });
    
  });
};

// Initialize the Sketchfab client
client.init(uid, {
  success: success,
  error: error,
  autostart: 1,
  preload: 1,
  autospin: autoSpin,
  transparent: 1,
  ui_infos: 0,
  ui_controls: 0,
  ui_stop: 0,
  ui_help: 0,
  ui_fullscreen: 0,
  ui_vr: 0,
});

// GUI Code
// Generate a flat list UI using nonParentNodes
function generateFlatList() {
  var navTree = document.getElementById("navTree"); // Use 'navTree' to match HTML

  navTree.innerHTML = ""; // Clear existing content
  nonParentNodes.forEach(function (node) {
    var li = document.createElement("li");
    li.className = "lineMain";
    var line1 = document.createElement("div");
    var line2 = document.createElement("div");
    line2.className = "line2";
    li.appendChild(line1);
    li.appendChild(line2);

    var span = document.createElement("span");
    span.className = "caret_child";
    span.textContent = node.name;
    line1.appendChild(span);
    line1.appendChild(createToggleButton("Toggle", node.instanceID, node.name));
    line2.appendChild(createOpacitySlider(1.0, node.materialIndex));
    navTree.appendChild(li);
  });
}



function createText(text) {
   var texto = document.createElement("text");
   texto.className = "texto";
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
function setOpacityForMaterial(materialIndex, opacity) {
  var targetMaterial = materials.find(function (mat) {
    //someday fix it
    return mat.stateSetID === materialIndex + 1;
  });
  if (!targetMaterial) {
    console.error(
      "No material found for material.index matching node.materialIndex: " +
        materialIndex
    );
    return;
  }
  console.log("Material properties:");
  for (var prop in targetMaterial) {
    if (targetMaterial.hasOwnProperty(prop)) {
      console.log(prop + ":", targetMaterial[prop]);
    }
  }
  targetMaterial.channels.Opacity.enable = true;
  targetMaterial.channels.Opacity.type = "alphaBlend";
  targetMaterial.channels.Opacity.factor = opacity;
  api.setMaterial(targetMaterial, function () {});
}

// Create a toggle button for visibility
function createToggleButton(btnType, instance, name) {
  const btn = document.createElement("button");
  btn.className = btnType;
  btn.id = instance + "_" + name + "_toggle";
  btn.value = instance;
  btn.dataset.isHidden = "false";
  btn.innerHTML = `<img src="eye_icon.svg" width="24" alt="Hide" />`;
  return btn;
}

function createLaudoButton() {
  let laudoBtn = document.getElementById("laudo");
  if (!laudoBtn) {
    laudoBtn = document.createElement("button");
    laudoBtn.id = "laudo";
    laudoBtn.className = "laudo-button";
    laudoBtn.style.backgroundColor = "white";
    laudoBtn.style.color = "black";
    laudoBtn.style.zIndex = "1000";
    laudoBtn.style.position = "fixed";
    laudoBtn.style.top = "745px";
    laudoBtn.style.right = "50px";
    laudoBtn.textContent = "Laudo";
    laudoBtn.style.zIndex = "11000";
    document.body.appendChild(laudoBtn);
  }
  return laudoBtn;
}

function createOptionsButton() {
  let optionsBtn = document.getElementById("options");
  if (!optionsBtn) {
    optionsBtn = document.createElement("button");
    optionsBtn.id = "options";
    optionsBtn.className = "options-button";
    optionsBtn.style.backgroundColor = "white";
    optionsBtn.style.color = "black";
    optionsBtn.style.zIndex = "1000";
    optionsBtn.style.position = "fixed";
    optionsBtn.style.top = "745px";
    optionsBtn.style.right = "120px";
    optionsBtn.textContent = "Opções";
    optionsBtn.style.zIndex = "11000";
    document.body.appendChild(optionsBtn);
  }
  return optionsBtn;
}

function toggleControls(show) {
  document.getElementById("navTree").style.display = show ? "inline-block" : "none";
  document.getElementById("subtitles").style.display = show ? "inline-block" : "none";
}

document.addEventListener("DOMContentLoaded", function () {
  createLaudoButton();
  createOptionsButton();

  const laudoBtn = document.getElementById("laudo");
  const optionsBtn = document.getElementById("options");

  laudoBtn.addEventListener("click", function () {
    console.log("Botão Laudo clicado!");
    toggleControls(false);

    async function getModelInfo() {
        const url = `https://api.sketchfab.com/v3/models/${MODEL_UID}`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Token ${API_TOKEN}`
                }
            });

            if (!response.ok) {
                throw new Error(`Erro: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            
            // Exibir a descrição no elemento "mensagem"
            const mensagemEl = document.getElementById("mensagem");
            if (mensagemEl) {
                mensagemEl.style.display = "inline-block";
                mensagemEl.innerHTML = `<p>${data.description}</p>`;
            } else {
                console.error("Elemento 'mensagem' não encontrado!");
            }
        } catch (error) {
            console.error(error);
        }
    }

    // Chamar a função para obter a descrição do modelo
    getModelInfo();
});

  optionsBtn.addEventListener("click", function () {
    console.log("Botão Opções clicado!");
    toggleControls(true);
    document.getElementById("mensagem").style.display = "none";
  });
});



document.addEventListener("DOMContentLoaded", function () {
  function createResetButton(btnType) {
    const reset = document.createElement("button"); // Criando um botão válido
    reset.className = btnType;
    reset.id = "resetCoords";
    reset.textContent = "Apagar a linha"; // Definindo o texto do botão
    reset.dataset.isHidden = "false";

    reset.style.position = "fixed"; // Garante que o botão esteja visível
    reset.style.bottom = "20px";
    reset.style.left = "20px";
    reset.style.padding = "10px 20px";
    reset.style.backgroundColor = "white";
    reset.style.color = "black";
    reset.style.border = "none";
    reset.style.cursor = "pointer";
    reset.style.zIndex = "1000"; // Garante que o botão fique acima de outros elementos

    reset.addEventListener("click", function () {
      oldX = null;
      oldY = null;
      oldZ = null;
      console.log("Coordenadas resetadas!");
    });

    document.body.appendChild(reset); // Adiciona o botão ao body
  }

  createResetButton("meu-botao"); // Chama a função para exibir o botão
});

// Recursively traverse the node tree to identify non-parent nodes
function recurse(nodeTree) {
  nodeTree.children.forEach((child) => {
    if (child.type === "MatrixTransform") {
      recurse(child);
    } else if (!seenNodes[child.instanceID]) {
      var node = {
        name: child.name,
        instanceID: child.instanceID,
        materialIndex: -1, // Initial value, updated later
      };
      nonParentNodes.push(node);
      seenNodes[child.instanceID] = true;
    }
  });
};

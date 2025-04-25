// main.js
// Sketchfab Viewer API: Start/Stop the viewer
var version = "1.12.0";
var api;
var materials = [];
var nonParentNodes = [];
var seenNodes = {};
var myNodesByNameFromMap = {};

var urlParams = new URLSearchParams(window.location.search);
var autoSpin = parseFloat(urlParams.get("autospin")) || 0.0;
var uid = urlParams.get("id") || "272a33d42c0a49949a21b6e79169606e";

var iframe = document.getElementById("api-frame");
var client = new window.Sketchfab(version, iframe);
const API_TOKEN = "ab5b84fd10044d7e9a172fc8748100c9";

var error = function () {
  console.error("Sketchfab API error");
};

var success = function (passedApi) {
  api = passedApi;
  api.start(function () {
    api.addEventListener("viewerready", function () {
      api.getMaterialList(function (err, mats) {
        if (!err && mats.length > 0) {
          materials = mats;
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
          for (var instanceID in nodes) {
            var node = nodes[instanceID];
            var name = node.name || "noname_" + instanceID;
            myNodesByNameFromMap[name] = node;
          }

          console.log("Node map:", nodes);
          Object.keys(nodes).forEach(function (nodeID) {
            var node = nodes[nodeID];
            console.log("Node ID:", nodeID, "Name:", node.name);
            console.log(node);
          });

          var rootNodeTree =
            myNodesByNameFromMap["RootNode"] || myNodesByNameFromMap["root"];
          if (rootNodeTree) {
            recurse(rootNodeTree);
            console.log("nonParentNodes (with instanceIDs):");
            nonParentNodes.forEach(function (node, index) {
              node.materialIndex = index % materials.length;
            });
            generateFlatList();
          }
          addToggleButton();
        }
      });

      setupUIOverlay();
      setupClickEventHandler();
    });
  });
};

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

function generateFlatList() {
  var navTree = document.getElementById("navTree");
  navTree.innerHTML = "";
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

function setOpacityForMaterial(materialIndex, opacity) {
  var targetMaterial = materials.find(function (mat) {
    return mat.stateSetID === materialIndex + 1;
  });
  if (!targetMaterial) {
    console.error("No material found for index: " + materialIndex);
    return;
  }
  targetMaterial.channels.Opacity.enable = true;
  targetMaterial.channels.Opacity.type = "alphaBlend";
  targetMaterial.channels.Opacity.factor = opacity;
  api.setMaterial(targetMaterial);
}

function recurse(nodeTree) {
  nodeTree.children.forEach((child) => {
    if (child.type === "MatrixTransform") {
      recurse(child);
    } else if (!seenNodes[child.instanceID]) {
      var node = {
        name: child.name,
        instanceID: child.instanceID,
        materialIndex: -1,
      };
      nonParentNodes.push(node);
      seenNodes[child.instanceID] = true;
    }
  });
}

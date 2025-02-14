// Sketchfab Viewer API: Start/Stop the viewer
var version = "1.9.0";
var uid = "1b5886557a0e4d998ce7027cbc2dbfe4";

var urlParams = new URLSearchParams(window.location.search);
var autoSpin = 0.0;

if (urlParams.has("autospin")) {
  autoSpin = urlParams.get("autospin");
}

if (urlParams.has("id")) {
  uid = urlParams.get("id");
}

var iframe = document.getElementById("api-frame");
var client = new window.Sketchfab(version, iframe);
var treeText = "";

var error = function () {
  console.error("Sketchfab API error");
};

//var myNodesByNameFromGraph = {};
var idxNodes = 0;
var myNodesByNameFromMap = {};
var officialNodes = [];

var objectID = -1;

var success = function (api) {
  api.start(function () {
    api.addEventListener("viewerready", function () {
      api.getNodeMap(function (err, nodes) {
        if (!err) {
          for (var instanceID in nodes) {
            var node = nodes[instanceID];
            var name = node.name;
            if (!name) name = "noname_" + idxNodes++;
            myNodesByNameFromMap[name] = node;
          }
          //console.log("nodes indexed by names from flattened array");
          //console.log(myNodesByNameFromMap);

          //attempt to look for a 'RootNode' - this seems to be present for FBX uploaded models
          rootNodeTree = myNodesByNameFromMap["RootNode"];

          if (rootNodeTree === undefined) {
            //attempt to look for a 'root' - this seems to be present for OBJ or single object models
            rootNodeTree = myNodesByNameFromMap["root"];
          }

          if (rootNodeTree != undefined) {
            recurse(rootNodeTree, rootNodeTree.children.length, 0);
            //console.log(officialNodes);

            //Now we can build the tree for the UI
            generateTree();
          }

          var hideButtons = document.getElementsByClassName("Hide");
          //console.log('HIDE BUTTONS LENGTH: ' + hideButtons.length);
          for (let i = 0; i < hideButtons.length; i++) {
            hideButtons[i].addEventListener("click", function () {
              //api.hide(this.value);
              this.style.backgroundColor = "red";

              var childButtons = document
                .getElementById(this.value)
                .getElementsByClassName("Hide");
              console.log(" Child Buttons: " + childButtons.length);

              if (childButtons.length == 0) {
                api.hide(this.value);
              }

              for (let j = 0; j < childButtons.length; j++) {
                hideBTN = document.getElementById(childButtons[j].id);
                //console.log(childButtons[i].id);
                hideBTN.style.backgroundColor = "red";
                api.hide(hideBTN.value);
              }
            });
          }

          var showButtons = document.getElementsByClassName("Show");
          //console.log('SHOW BUTTONS LENGTH: ' + showButtons.length);
          for (let k = 0; k < showButtons.length; k++) {
            showButtons[k].addEventListener("click", function () {
              api.show(this.value);
              var hideBTN = document.getElementById(
                this.id + "_" + this.name + "Hide"
              );
              hideBTN.style.backgroundColor = "green";

              var childButtons = document
                .getElementById(this.value)
                .getElementsByClassName("Show");
              //console.log(' Child Buttons: ' + childButtons.length);
              for (let l = 0; l < childButtons.length; l++) {
                api.show(childButtons[l].value);
                hideBTN = document.getElementById(childButtons[l].id + "_Hide");
                hideBTN.style.backgroundColor = "green";
              }
            });
          }
        }
      var toggleButtons = document.getElementsByClassName("Toggle");
      for (let i = 0; i < toggleButtons.length; i++) {
        toggleButtons[i].addEventListener("click", function () {
          if (this.dataset.isHidden === "false") {
            api.hide(this.value);
            this.dataset.isHidden = "true";
            this.innerHTML = `<img src="eye_off_icon.svg" width="24" alt="Show" />`;
            const childToggles = document
              .getElementById(this.value)
              .getElementsByClassName("Toggle");
            for (let j = 0; j < childToggles.length; j++) {
              api.hide(childToggles[j].value);
              childToggles[j].dataset.isHidden = "true";
              childToggles[j].innerHTML = `<img src="eye_off_icon.svg" width="24" alt="Show" />`;
            }
          } else {
            api.show(this.value);
            this.dataset.isHidden = "false";
            this.innerHTML = `<img src="eye_icon.svg" width="24" alt="Hide" />`;
            const childToggles = document
              .getElementById(this.value)
              .getElementsByClassName("Toggle");
            for (let j = 0; j < childToggles.length; j++) {
              api.show(childToggles[j].value);
              childToggles[j].dataset.isHidden = "false";
              childToggles[j].innerHTML = `<img src="eye_icon.svg" width="24" alt="Hide" />`;
            }
          }
        });
      }
      });
      /*  
        document.getElementById('screenshot').addEventListener('click', function () {
           api.getScreenShot(800, 800, 'image/png', function (err, result) {
           if (!err) {
             var anchor = document.createElement('a');
             anchor.href = result;
             anchor.download = 'screenshot.png';
             anchor.innerHTML = '<img width="100" height="100" src=' + result + '>';
             document.getElementById('navTree').appendChild(anchor);
            }
          });
        });
        */

      /*
            document.getElementById('show').addEventListener('click', function () {
                api.show(id);
            });
            
            */
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
  ui_infos: 0,        // Hide model info
  ui_controls: 0,     // Hide bottom-right controls
  ui_stop: 0,         // Hide pause button
  ui_help: 0,         // Hide help icon
  ui_fullscreen: 0,   // Hide fullscreen icon
  ui_vr: 0            // Hide VR icon
});
//////////////////////////////////
// GUI Code
//////////////////////////////////
function initGui() {
  var controls = document.getElementById("navTree");
  var buttonsText = "";
  buttonsText += '<button id="screenshot"></button>';
  controls.innerHTML = buttonsText;
}
//initGui();

function generateTree() {
  //console.log("Total Node Count: " + officialNodes.length);

  var tree = unflatten(officialNodes);
  //console.log(tree);

  //Create the HTML UL elemenet of the objects
  var navTree = document.getElementById("navTree");
  navTree.appendChild(to_ul(tree, "myUL"));

  var toggler = document.getElementsByClassName("caret");
  var i;

  for (i = 0; i < toggler.length; i++) {
    toggler[i].addEventListener("click", function () {
      this.parentElement.querySelector(".nested").classList.toggle("active");
      this.classList.toggle("caret-down");
    });
  }
}

function unflatten(arr) {
  var tree = [],
    mappedArr = {},
    arrElem,
    mappedElem;

  // First map the nodes of the array to an object -> create a hash table.
  for (var i = 0, len = arr.length; i < len; i++) {
    arrElem = arr[i];
    mappedArr[arrElem.instanceID] = arrElem;
    mappedArr[arrElem.instanceID].children = [];
  }

  for (var id in mappedArr) {
    if (mappedArr.hasOwnProperty(id)) {
      mappedElem = mappedArr[id];
      // If the element is not at the root level, add it to its parent array of children.
      if (mappedElem.parentID) {
        mappedArr[mappedElem.parentID].children.push(mappedElem);
      }
      // If the element is at the root level, add it to first level elements array.
      else {
        tree.push(mappedElem);
      }
    }
  }
  return tree;
}

/**********************
  GENERATE HTML UL TREE
**********************/
function to_ul(branches, setID = "", setClass = "") {
  var outerul = document.createElement("ul");
  var lengthOfName = 14;

  if (setID != "") {
    outerul.id = setID;
  }
  if (setClass != "") {
    outerul.className = setClass;
  }

  for (var i = 0, n = branches.length; i < n; i++) {
    var branch = branches[i];
    var li = document.createElement("li");

    var text = branch.name.replace(/_/g, " ");
    if (text.length > lengthOfName) {
      text = text.substring(0, lengthOfName);
      text += "...";
      
    }
    text = text.substring(0, text.length - 2);
    var textNode = document.createTextNode(text);
    

    if (branch.isParent) {
      // var sp = document.createElement("span");
      // sp.className = "Structures";
      // sp.appendChild(textNode);
      // sp.textContent = "Estruturas";
      // li.appendChild(sp);
      // li.appendChild(createButton("Hide", branch.instanceID, branch.name));
      // li.appendChild(createButton("Show", branch.instanceID, branch.name));
    } else {
      var sp2 = document.createElement("span");
      sp2.className = "caret_child";
      sp2.appendChild(textNode);
      li.appendChild(sp2);
      li.appendChild(createToggleButton("Toggle", branch.instanceID, branch.name));
      // li.appendChild(createButton("Hide", branch.instanceID, branch.name));
      // li.appendChild(createButton("Show", branch.instanceID, branch.name));
    }

    if (branch.children) {
      li.appendChild(to_ul(branch.children, branch.instanceID, "nested"));
    }

    outerul.appendChild(li);
  }

  console.log(outerul);
  return outerul;
}

// function createButton(btnType, instance, name) {
//   var btn = document.createElement("button");
//   btn.type = "button";
//   btn.className = btnType;

//   if (btnType == "Hide") {
//     btn.id = instance + "_" + name + "_" + btnType;
//     btn.style.backgroundColor = "green";
//   } else {
//     btn.id = instance + "_" + name;
//   }
//   btn.value = instance;
//   var btnText = document.createTextNode(btnType);
//   btn.appendChild(btnText);

//   return btn;
// }

/*
 * Creates a toggle button that hides/shows a Sketchfab node.
 * @param {Object} api - The Sketchfab Viewer API instance.
 * @param {Number} instance - The instanceID of the Sketchfab node.
 * @param {String} name - The name of the Sketchfab node.
 * @returns {HTMLButtonElement} A button element with toggle functionality.
 */
function createToggleButton(btnType, instance, name) {
  const btn = document.createElement("button");
  btn.className = btnType;
  // Give each button a unique ID
  btn.id = instance + "_" + name + "_toggle";

  // Keep the instanceID in the value property so you can reference it
  btn.value = instance;

  // Start in the "visible" state (eye icon)
  btn.dataset.isHidden = "false";
  btn.innerHTML = `<img src="eye_icon.svg" width="24" alt="Hide" />`;

  btn.addEventListener("click", function () {
    if (btn.dataset.isHidden === "false") {
      // Hide the model
      api.hide(btn.value);
      btn.dataset.isHidden = "true";
      btn.innerHTML = `<img src="eye_off_icon.svg" width="24" alt="Show" />`;
    } else {
      // Show the model
      api.show(btn.value);
      btn.dataset.isHidden = "false";
      btn.innerHTML = `<img src="eye_icon.svg" width="24" alt="Hide" />`;
    }
  });

  return btn;
}

//////////////////////////////////
// GUI Code end
//////////////////////////////////

function recurse(nodeTree, childCount, theParentID) {
  if (typeof nodeTree != "undefined") {
    //Process the children of this node tree
    for (var i = 0; i < childCount; i++) {
      var node = {
        name: nodeTree.children[i].name,
        type: nodeTree.children[i].type,
        instanceID: nodeTree.children[i].instanceID,
        isParent: false,
        parentID: theParentID,
      };

      if (node.type == "MatrixTransform") {
        //Determine if this node is a parent
        node.isParent = isParent(nodeTree.children[i].children);

        console.log(
          "   " +
            node.name +
            "(Node Type:" +
            node.type +
            ")" +
            "(Instance ID: " +
            node.instanceID +
            ")" +
            "(Is Parent: " +
            node.isParent +
            ")" +
            "(Parent ID: " +
            node.parentID +
            ")" +
            " Child Count :" +
            nodeTree.children[i].children.length
        );

        //Add this node to the complete node array list we are constructing
        officialNodes.push(node);

        recurse(
          nodeTree.children[i],
          nodeTree.children[i].children.length,
          nodeTree.children[i].instanceID
        );
      }
    }
  }
}

function isParent(children) {
  //Look through all the children to see if a "MatrixTransform" type exists...

  var result = false;

  for (var i = 0; i < children.length; i++) {
    if (children[i].type == "MatrixTransform") {
      result = true;
      console.log("PARENT NODE DETECTED");
      break;
    } else {
      result = false;
    }
  }

  return result;
}

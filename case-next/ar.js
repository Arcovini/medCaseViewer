// case-next/ar.js
// Composição AR: monta um <model-viewer> oculto pra detectar capacidade AR
// (canActivateAR) e disparar activateAR(). No iOS, gera USDZ on-demand a
// partir da cena Three.js já carregada via USDZExporter. No desktop, abre
// um modal com QR code da URL atual.
//
// Mantém a separação 4-camadas do Sprint 3a: importa só de loader (rede),
// world (3D, via getMountedRoot), dom (DOM helpers). Não toca direto em
// document.* exceto pelo container #ar-root reservado em index.html.

import { buildGlbUrl } from "./loader.js";
import { getMountedRoot } from "./world.js";
import { mountARButton, mountARModal, showError } from "./dom.js";

// CDNs pinadas (sem build step; versões fixadas pra reprodutibilidade)
const MODEL_VIEWER_URL = "https://unpkg.com/@google/model-viewer@4.0.0/dist/model-viewer.min.js";
const QRCODE_URL = "https://esm.sh/qrcode@1.5.3";
// USDZExporter já está disponível via import map (three/addons/...)
const USDZ_EXPORTER_URL = "three/addons/exporters/USDZExporter.js";

const MODEL_VIEWER_LOAD_TIMEOUT_MS = 6000;

let _world, _dom, _uid;
let _arButton, _arModal;
let _mvEl = null;            // instância do <model-viewer>
let _capabilities = null;    // { platform, canActivateAR }
let _isReady = false;
let _usdzObjectUrl = null;   // memoizado após primeira geração
let _qrcodeImportPromise = null;
let _modelViewerImportPromise = null;

export function isReady() { return _isReady; }
export function getCapabilities() { return _capabilities; }

// Exposto para tests inspecionarem o elemento oculto.
export function getModelViewerElement() { return _mvEl; }

function _classifyPlatform() {
  const ua = navigator.userAgent;
  // iPad em modo desktop (iPadOS 13+) reporta UA Macintosh; checar touch points.
  const iPadAsMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadAsMac) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

async function _loadModelViewerLib() {
  // Test hook: setupAR injeta __mockModelViewerImport pra evitar baixar
  // o script real (que registra customElements e não pode ser desfeito).
  if (typeof window !== "undefined" && window.__mockModelViewerImport) {
    return window.__mockModelViewerImport();
  }
  if (!_modelViewerImportPromise) {
    _modelViewerImportPromise = import(/* @vite-ignore */ MODEL_VIEWER_URL);
  }
  return _modelViewerImportPromise;
}

function _mountModelViewer() {
  const root = document.getElementById("ar-root");
  if (!root) throw new Error("ar-root container missing");
  const el = document.createElement("model-viewer");
  el.setAttribute("src", buildGlbUrl(_uid));
  el.setAttribute("ar", "");
  el.setAttribute("ar-modes", "webxr scene-viewer quick-look");
  el.setAttribute("ar-scale", "auto");
  el.setAttribute("ar-placement", "floor");
  // reveal=manual evita que o model-viewer renderize visivelmente / faça
  // sua própria UI de poster/loading (não é o motor visível — Three.js é).
  el.setAttribute("reveal", "manual");
  root.appendChild(el);
  _mvEl = el;
  return el;
}

function _waitForReady(el, timeoutMs = MODEL_VIEWER_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("model-viewer load timeout")),
      timeoutMs,
    );
    el.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
    el.addEventListener("error", (e) => { clearTimeout(timer); reject(e); }, { once: true });
  });
}

async function _generateUSDZBlobUrl() {
  if (_usdzObjectUrl) return _usdzObjectUrl;

  const root = getMountedRoot();
  if (!root) throw new Error("scene not mounted");

  // Clone defensivo: world.js seta `transparent: true` e `depthWrite: true`
  // permanentemente nos materiais (estratégia anti-hitch do Sprint 3a). Isso
  // pode confundir o USDZExporter — exportar sem esses flags em materiais
  // 100% opacos produz um USDZ mais limpo no AR Quick Look.
  const sceneClone = root.clone(true);
  sceneClone.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const cloned = mats.map((m) => {
        const c = m.clone();
        if ((c.opacity ?? 1) >= 0.999) c.transparent = false;
        c.depthWrite = true;
        return c;
      });
      obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
    }
  });

  // USDZ Quick Look interpreta unidades como metros. Os GLBs do mesh-processor
  // vêm em milímetros (1 unidade Three.js = 1 mm — ver measurement.js, que
  // usa distanceTo() direto como mm). Sem este reescalonamento o modelo
  // aparece 1000x maior do esperado no AR do iPhone.
  sceneClone.scale.multiplyScalar(0.001);

  const exporterModule = (typeof window !== "undefined" && window.__mockUSDZExporterImport)
    ? await window.__mockUSDZExporterImport()
    : await import(/* @vite-ignore */ USDZ_EXPORTER_URL);
  const { USDZExporter } = exporterModule;
  const bytes = await new USDZExporter().parseAsync(sceneClone);
  const blob = new Blob([bytes], { type: "model/vnd.usdz+zip" });
  _usdzObjectUrl = URL.createObjectURL(blob);
  return _usdzObjectUrl;
}

function _decideButtonVisibility(platform, canActivateAR) {
  if (platform === "desktop") {
    _arButton.setVisible(true);   // QR mode
    return;
  }
  // iOS: <model-viewer>.canActivateAR só vira true se `ios-src` estiver
  // presente no mount, e geramos o USDZ on-demand no click (custo alto demais
  // pra rodar no init). Confiamos na plataforma — iOS 12+ sempre suporta
  // Quick Look. Versões pré-12 falham em activateAR() e o erro chega via
  // showError(), o que é informação útil pro clínico.
  if (platform === "ios") {
    _arButton.setVisible(true);
    return;
  }
  if (canActivateAR) {
    _arButton.setVisible(true);   // android + AR-capable
    return;
  }
  _arButton.setVisible(false);    // android sem AR — esconde
}

async function _loadQRCodeLib() {
  if (!_qrcodeImportPromise) {
    _qrcodeImportPromise = (typeof window !== "undefined" && window.__mockQRCodeImport)
      ? window.__mockQRCodeImport()
      : import(/* @vite-ignore */ QRCODE_URL);
  }
  const mod = await _qrcodeImportPromise;
  return mod.default ?? mod;
}

async function _openQRModal() {
  const qrcode = await _loadQRCodeLib();
  const dataUrl = await qrcode.toDataURL(window.location.href, {
    width: 240,
    margin: 1,
  });
  _arModal.showWithQR(dataUrl);
}

async function _handleClick() {
  if (!_capabilities) return;     // ainda inicializando

  if (_capabilities.platform === "desktop") {
    try {
      await _openQRModal();
    } catch (err) {
      console.error("[ar] failed to open QR modal", err);
      showError("Não foi possível gerar o QR code.");
    }
    return;
  }

  // Mobile path (ios ou android)
  try {
    if (_capabilities.platform === "ios") {
      _arButton.setLoading(true);
      const usdzUrl = await _generateUSDZBlobUrl();
      _mvEl.setAttribute("ios-src", usdzUrl);
      _arButton.setLoading(false);
    }
    await _mvEl.activateAR();
  } catch (err) {
    _arButton.setLoading(false);
    console.error("[ar] activate failed", err);
    showError("Não foi possível iniciar a visualização em AR.");
  }
}

export async function init({ world, dom, uid }) {
  _world = world;
  _dom = dom;
  _uid = uid;

  // Bota botão e modal cedo. Botão começa invisível e só vira visível depois
  // de termos a info de canActivateAR — fluxo "fail-closed".
  _arButton = mountARButton({ onClick: _handleClick });
  _arModal = mountARModal({});

  // Classifica plataforma e revela o botão *imediatamente* em desktop —
  // o fluxo QR não precisa de model-viewer (só geramos QR no clique).
  // No mobile (ios/android) o botão continua a depender do load do
  // model-viewer abaixo pra checar canActivateAR.
  const earlyPlatform = _classifyPlatform();
  if (earlyPlatform === "desktop") {
    _capabilities = { platform: "desktop", canActivateAR: false };
    _arButton.setVisible(true);
  }

  try {
    await _loadModelViewerLib();
    const el = _mountModelViewer();

    // Tenta esperar o `load` do <model-viewer>, mas tolera timeout: o load
    // depende do <model-viewer> baixar o GLB internamente (além do Three.js
    // já ter baixado), e isso pode falhar por CORS preflight diferente,
    // bundling duplicado de Three.js, latência via túnel, etc. Em qualquer
    // caso, no iOS o Quick Look funciona via ios-src (USDZ on-demand) sem
    // depender do load do model-viewer; no Android, canActivateAR pode ser
    // false e a gente apenas esconde o botão.
    let canActivateAR = false;
    try {
      await _waitForReady(el);
      canActivateAR = !!el.canActivateAR;
    } catch (loadErr) {
      console.warn("[ar] model-viewer load timeout; seguindo com capability snapshot", loadErr);
      canActivateAR = !!el.canActivateAR;
    }

    const platform = _classifyPlatform();
    _capabilities = { platform, canActivateAR };
    _decideButtonVisibility(platform, canActivateAR);
  } catch (err) {
    // Falha em etapa não-recuperável (import do model-viewer, mount do custom
    // element): silenciosamente desabilita AR. Viewer continua funcionando.
    console.warn("[ar] init falhou; AR desabilitado", err);
    _capabilities = { platform: _classifyPlatform(), canActivateAR: false };
    _arButton.setVisible(false);
  } finally {
    _isReady = true;
  }
}

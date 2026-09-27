// case/exam.js
// Exame de imagem no caso: estado e orquestração. Liga loader (baixa o NRRD),
// exam-geom (geometria e pixels), slice-view (as vistas de corte), world (os
// planos no 3D) e dom (painel, layout, celular). Mesmo padrão dos outros
// módulos de feature: init(...) devolve uma API; main.js compõe.
//
// Fonte única da imagem: um canvas fora da tela por plano, na resolução nativa
// da fatia. A vista 2D o desenha encaixado e espelhado conforme a convenção
// radiológica; o 3D o usa como textura do quad. Um corte muda → uma extração,
// dois consumidores.

import * as G from "./exam-geom.js";
import { createSliceView } from "./slice-view.js";

const MOBILE = window.matchMedia("(max-width: 768px)");

export function init({ world, dom, loader, hasModel, onTabChange, onLayoutChange }) {
  const stage = document.querySelector(".vw-stage");
  const sections = Object.fromEntries(
    G.PLANES.map((p) => [p, stage.querySelector(`.slice-view[data-plane="${p}"]`)]),
  );
  const miniOpen = stage.querySelector('[data-testid="mini3d-open"]');
  const view3d = stage.querySelector(".vw-3d");
  const colors = Object.fromEntries(
    G.PLANES.map((p) => [p, cssVar(`--w-plane-${p}`) || "#ffffff"]),
  );

  // ---- Estado ---------------------------------------------------------------
  let probe = null;
  // Séries do caso (loader.fetchExamSeries); a 0 é a usada na segmentação.
  let series = [];
  let current = 0;           // índice em `series` da série na tela
  const volCache = new Map(); // índice → { data, header }, na ordem de uso
  let switchSeq = 0;         // troca mais recente (descarta respostas velhas)
  let viewsMounted = false;
  let loadPromise = null;
  let loaded = false;
  let geo = null, data = null, axes = null;
  const layouts = {};   // plano → exam-geom.planeLayout
  const offscreen = {}; // plano → { canvas, ctx, image, buf32 }
  const views = {};     // plano → slice-view
  const index = {};     // plano → índice atual
  const planeOn = { axial: false, coronal: false, sagittal: false };
  let autoWin = null, win = null, brightness = 50, contrast = 50;
  // Janela de base (brilho/contraste ajustam a partir dela): um preset de TC,
  // a digitada ("custom") ou a automática. ct: a série está em Hounsfield.
  let baseWin = null, customWin = null, preset = null, ct = false;
  let layout = "3d";         // "3d" | "3d+1" | "3d+3" | "quad" | "single" (celular)
  let primary = "axial";     // plano ao lado do 3D em "3d+1"
  let single = "3d";         // celular, "Uma vista": "3d" | plano
  let mini3d = false;
  let crossOn = true;
  let contourOn = true;
  let eyesTouched = false;   // o usuário mexeu num olho: não decidimos mais por ele
  let suspended = null;      // layout guardado enquanto Medir/Cortar está ativo
  let toolActive = false;    // Medir/Cortar em uso: clique no 3D é da ferramenta
  // Contorno das estruturas: malha em coordenadas IJK (uma vez por geometria
  // de malha e por série — o IJK depende da geometria do volume) e segmentos
  // por (plano, corte), guardados enquanto nada muda.
  let ijkByGeometry = new WeakMap();
  const segCache = new Map();

  // ---- Interface -------------------------------------------------------------
  const tabs = dom.mountPanelTabs({ onTab: (t) => setTab(t) });
  const switcher = dom.mountLayoutSwitcher({ onLayout: (l) => setLayout(l) });
  const hint = dom.mountExamHint({ onOpen: () => setLayout(MOBILE.matches ? "single" : "3d+1", { single: primary }) });
  const mobile = dom.mountMobileExamChrome({
    onView: (l) => setLayout(l),
    onSingle: (v) => setLayout("single", { single: v }),
    onMini3d: (on) => { mini3d = on; applyLayout(); },
    onExamButton: () => examButtonHandler?.(),
  });
  let examButtonHandler = null;
  miniOpen.addEventListener("click", () => setLayout("single", { single: "3d" }));

  // Toque/clique curto num plano do 3D leva a mira até o ponto: os outros dois
  // planos passam a cortar ali. Arrastar continua sendo girar a câmera.
  const canvas3d = world.getCanvasElement();
  let down = null;
  canvas3d?.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas3d?.addEventListener("pointerup", (e) => {
    const d = down;
    down = null;
    if (!d || !loaded || toolActive) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return;
    const hit = world.raycastSlicePlanes(e.clientX, e.clientY);
    if (!hit) return;
    const ijk = G.worldToIjk(geo, hit.point);
    for (const p of G.PLANES) if (p !== hit.plane) setIndex(p, ijk[axes[p]]);
  });

  // ---- Descoberta ------------------------------------------------------------

  // Oferece o exame sem baixar (caso com modelo): ícones de layout, aviso,
  // aba Exame e botão Exame no celular.
  function offer(p) {
    probe = p;
    series = p.series;
    tabs.show({ hasStructures: hasModel });
    switcher.show();
    mobile.show();
    const size = primarySize();
    hint.show(size);
    dom.renderExamPanelPending({
      sizeText: size,
      seriesCount: series.length,
      onLoad: () => setLayout(MOBILE.matches ? "single" : "3d+1", { single: primary }),
    });
    applyLayout();
  }

  function primarySize() {
    const b = series[0]?.bytes;
    return b ? formatMB(b) : null;
  }

  function ensureLoaded() {
    if (loaded) return Promise.resolve(true);
    if (!loadPromise) loadPromise = doLoad();
    return loadPromise;
  }

  async function doLoad() {
    hint.setBusy(true);
    dom.renderExamPanelMessage("Carregando exame…");
    try {
      const vol = await loader.loadExam(series[current].url);
      remember(current, vol);
      setup(vol);
      loaded = true;
      return true;
    } catch (e) {
      console.error("[exam] falha ao carregar", e);
      loadPromise = null;
      const parse = e.code === "PARSE";
      dom.renderExamPanelMessage(
        parse
          ? "O arquivo do exame está corrompido. Peça um novo envio."
          : "Não foi possível baixar o exame. Verifique a conexão e tente de novo.",
        parse ? null : () => setLayout(MOBILE.matches ? "single" : "3d+1", { single: primary }),
      );
      hint.setBusy(false);
      if (hasModel && !parse) hint.show(primarySize());
      return false;
    }
  }

  // Primeira série carregada: monta as vistas e aplica os padrões de abertura.
  function setup(vol) {
    mountViews();
    applySeries(vol, null);
    // Caso só com exame: os três planos no 3D (é o único conteúdo da cena).
    // Com modelo: só o plano ao lado do 3D, para não esconder o modelo.
    for (const p of G.PLANES) setPlaneVisible(p, hasModel ? p === primary : true);
    hint.hide();
  }

  // As vistas de corte existem uma vez; trocar de série só troca o que elas
  // desenham.
  function mountViews() {
    if (viewsMounted) return;
    viewsMounted = true;
    for (const p of G.PLANES) {
      views[p] = createSliceView(sections[p], p, {
        onIndex: (plane, i) => setIndex(plane, i),
        // Celular, miniaturas (tira e grade): tocar abre o corte, não move a mira.
        onPick: (plane, h, v, done) => {
          if (MOBILE.matches && (layout === "3d+3" || layout === "quad")) {
            if (done) promote(plane);
            return;
          }
          pick(plane, h, v);
        },
        onPromote: (plane) => promote(plane),
        onSwitchPlane: (_from, to) => { setPrimary(to); applyLayout(); },
      });
      sections[p].style.setProperty("--plane", colors[p]);
    }
  }

  // Série na tela: geometria, canvases fora da tela, janela automática, planos
  // no 3D e painel. `keep` = ponto da mira no mundo, para a nova série abrir no
  // mesmo nível anatômico (as séries de um exame dividem o sistema de
  // coordenadas do paciente); null = meio do volume.
  function applySeries({ data: d, header }, keep) {
    data = d;
    geo = G.normalizeHeader(header);
    axes = G.assignPlaneAxes(geo);
    const ijk = keep ? G.worldToIjk(geo, keep) : null;
    for (const p of G.PLANES) {
      const l = G.planeLayout(geo, p, axes);
      layouts[p] = l;
      const canvas = document.createElement("canvas");
      canvas.width = l.nh;
      canvas.height = l.nv;
      const ctx = canvas.getContext("2d");
      const image = ctx.createImageData(l.nh, l.nv);
      offscreen[p] = { canvas, ctx, image, buf32: new Uint32Array(image.data.buffer) };
      index[p] = ijk
        ? Math.max(0, Math.min(l.count - 1, Math.round(ijk[axes[p]])))
        : Math.floor(l.count / 2);
    }
    // Janela: TC ganha os presets clínicos, e o escolhido (ou a janela
    // digitada) continua ao trocar de série — a escala Hounsfield é a mesma em
    // todas as fases. Fora da TC, a automática da série. Brilho e contraste
    // voltam a 50 (a base) em qualquer troca.
    autoWin = G.autoWindow(data);
    const wasCt = ct;
    ct = G.isHounsfield(data);
    if (!ct) preset = "auto";
    else if (!preset || (preset === "auto" && !wasCt)) preset = "soft";
    brightness = 50;
    contrast = 50;
    baseWin = baseFor(preset);
    win = baseWin;
    ijkByGeometry = new WeakMap();
    segCache.clear();

    for (const p of G.PLANES) {
      views[p].setLayout(layouts[p]);
      views[p].setSource(offscreen[p].canvas);
      world.addSlicePlane(p, offscreen[p].canvas, colors[p]);
      world.setSlicePlaneVisible(p, planeOn[p]);
    }
    renderPanel();
    // Desenho síncrono: os quads do 3D precisam dos cantos antes de a câmera
    // enquadrar o caso só com exame (world.frameToScene).
    for (const p of G.PLANES) dirty.add(p);
    flush();
  }

  function renderPanel() {
    // k é a direção em que o aparelho empilhou as imagens (a série DICOM).
    const [ni, nj, nk] = geo.dims;
    const multi = series.length > 1;
    dom.renderExamPanel(
      {
        subtitle: `${nk} imagens · ${formatMm(geo.spacing[2])} · ${ni}×${nj}`,
        planes: G.PLANES.map((p) => ({ name: p, label: G.PLANE_LABEL[p], count: layouts[p].count })),
        // TC: presets clínicos no lugar do botão Auto (que vira um deles).
        presets: ct ? G.CT_PRESETS : null,
        series: multi
          ? series.map((s, i) => ({
            label: s.label,
            meta: `${s.images} imagens · ${formatMm(s.spacing[2])}`,
            badge: hasModel && s.primary ? "usada na segmentação" : null,
            size: volCache.has(i) || !s.bytes ? null : formatMB(s.bytes),
            current: i === current,
          }))
          : null,
        // Mesmo sistema de coordenadas não é mesma posição dos órgãos: entre
        // uma fase e outra o paciente respira.
        note: hasModel && multi && current !== 0
          ? `As estruturas foram segmentadas na série ${series[0].label}. Nesta série pode haver deslocamento de alguns milímetros (respiração entre as fases).`
          : null,
      },
      {
        onSeries: (i) => selectSeries(i),
        onPlaneIndex: (p, i) => setIndex(p, i),
        onPlaneVisible: (p, on) => { eyesTouched = true; setPlaneVisible(p, on); },
        onAuto: () => setPreset("auto"),
        onPreset: (p) => setPreset(p),
        onWindowLevel: (w, l) => setWindowLevel(w, l),
        onBrightness: (v) => { brightness = v; updateWindow(); },
        onContrast: (v) => { contrast = v; updateWindow(); },
        onOption: (opt, on) => {
          if (opt === "cross") { crossOn = on; for (const p of G.PLANES) views[p].setCrosshairVisible(on); }
          if (opt === "contour") { contourOn = on; invalidateAll(); }
        },
      },
    );
    dom.setExamControls({ brightness, contrast, preset, ...G.levelOf(win) });
    // Sem modelo não há estrutura para contornar.
    if (!hasModel) dom.hideExamOption("contour");
    dom.setExamOption("contour", contourOn);
    dom.setExamOption("cross", crossOn);
    for (const p of G.PLANES) dom.setPlaneRow(p, { visible: planeOn[p] });
  }

  // ---- Séries --------------------------------------------------------------------

  // Troca a série na tela. Baixa só quando escolhida; se falhar, a série atual
  // continua. Desktop guarda todas as baixadas; celular, as 2 mais recentes.
  async function selectSeries(i) {
    if (!loaded || i === current || !series[i]) return false;
    const seq = ++switchSeq;
    dom.setSeriesBusy(i, true);
    let vol = volCache.get(i);
    if (!vol) {
      try {
        vol = await loader.loadExam(series[i].url);
      } catch (e) {
        console.error("[exam] falha ao carregar a série", e);
        dom.setSeriesBusy(i, false);
        if (seq === switchSeq) {
          dom.setSeriesStatus(e.code === "PARSE"
            ? "O arquivo desta série está corrompido. Peça um novo envio."
            : "Não foi possível baixar esta série. Verifique a conexão e tente de novo.");
        }
        return false;
      }
    }
    if (seq !== switchSeq) return false; // outra troca começou depois desta
    const keep = crossWorld();
    remember(i, vol);
    current = i;
    applySeries(vol, keep);
    return true;
  }

  function remember(i, vol) {
    volCache.delete(i);
    volCache.set(i, vol);
    const max = MOBILE.matches ? 2 : Infinity;
    for (const k of volCache.keys()) {
      if (volCache.size <= max) break;
      if (k !== i) volCache.delete(k);
    }
  }

  // Ponto onde os três planos se cruzam, no mundo.
  function crossWorld() {
    const ijk = [0, 0, 0];
    for (const p of G.PLANES) ijk[axes[p]] = index[p];
    return G.ijkToWorld(geo, ijk[0], ijk[1], ijk[2]);
  }

  // ---- Desenho ----------------------------------------------------------------

  const dirty = new Set();
  let raf = 0;
  function invalidate(p) {
    dirty.add(p);
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function invalidateAll() { for (const p of G.PLANES) invalidate(p); }

  function flush() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!geo) return;
    for (const p of dirty) renderPlane(p);
    dirty.clear();
    updateCrosshairs();
  }

  function renderPlane(p) {
    const l = layouts[p], o = offscreen[p];
    G.extractSlice(data, geo.dims, l, index[p], win.lo, win.hi, o.buf32);
    o.ctx.putImageData(o.image, 0, 0);
    world.updateSlicePlane(p, G.sliceCorners(geo, l, index[p]));
    world.markSlicePlaneDirty(p);
    views[p].setIndex(index[p]);
    views[p].redraw();
    views[p].setSegments(contourOn && hasModel ? contourFor(p, index[p]) : []);
    dom.setPlaneRow(p, { index: index[p], count: l.count });
  }

  // Mira de cada vista = onde estão os outros dois planos. Os planos seguem os
  // eixos IJK, então o plano cuja normal é o eixo horizontal da vista aparece
  // como uma linha vertical, e vice-versa.
  function updateCrosshairs() {
    const planeOfAxis = invert(axes);
    for (const p of G.PLANES) {
      const l = layouts[p];
      const ph = planeOfAxis[l.h], pv = planeOfAxis[l.v];
      views[p].setCrosshair({ h: index[ph], v: index[pv], hColor: colors[ph], vColor: colors[pv] });
    }
  }

  function contourFor(p, n) {
    const key = `${p}:${n}`;
    if (segCache.has(key)) return segCache.get(key);
    const l = layouts[p];
    const out = [];
    for (const name of world.getMeshNames()) {
      if (!world.getMeshVisibility(name)) continue;
      const soup = world.getMeshTriangleSoup(name);
      if (!soup) continue;
      let ijk = ijkByGeometry.get(soup);
      if (!ijk) {
        ijk = G.worldArrayToIjk(geo, soup.positions);
        ijkByGeometry.set(soup, ijk);
      }
      const points = G.meshPlaneSegments(ijk, soup.indices, l.axis, l.h, l.v, n);
      if (points.length) out.push({ name, color: world.getMeshColor(name) || "#ffffff", points });
    }
    segCache.set(key, out);
    if (segCache.size > 96) segCache.delete(segCache.keys().next().value);
    return out;
  }

  function baseFor(p) {
    if (p === "auto") return autoWin;
    if (p === "custom" && customWin) return customWin;
    const pr = G.CT_PRESETS.find((x) => x.id === p) || G.CT_PRESETS[0];
    return G.windowFromLevel(pr.width, pr.level);
  }

  // Preset (ou "auto"): vira a base, e brilho/contraste voltam ao meio.
  function setPreset(p) {
    if (!geo) return;
    preset = p;
    baseWin = baseFor(p);
    brightness = 50;
    contrast = 50;
    win = baseWin;
    dom.setExamControls({ brightness, contrast, preset, ...G.levelOf(win) });
    invalidateAll();
  }

  // Janela e nível digitados: viram a base ("custom").
  function setWindowLevel(width, level) {
    if (!geo || !(width >= 1) || !Number.isFinite(level)) return false;
    customWin = G.windowFromLevel(width, level);
    setPreset("custom");
    return true;
  }

  function updateWindow() {
    win = G.windowFromControls(baseWin, brightness, contrast);
    dom.setExamControls(G.levelOf(win));
    invalidateAll();
  }

  // ---- Ações -------------------------------------------------------------------

  function setIndex(p, i) {
    if (!geo) return;
    const n = Math.max(0, Math.min(layouts[p].count - 1, Math.round(i)));
    if (n === index[p]) return;
    index[p] = n;
    invalidate(p);
  }

  function pick(p, h, v) {
    const l = layouts[p];
    const planeOfAxis = invert(axes);
    setIndex(planeOfAxis[l.h], h);
    setIndex(planeOfAxis[l.v], v);
  }

  function setPlaneVisible(p, on) {
    planeOn[p] = on;
    world.setSlicePlaneVisible(p, on);
    dom.setPlaneRow(p, { visible: on });
  }

  // Levar um corte para perto: no desktop vira o corte ao lado do 3D; no
  // celular (miniatura, quadrante) abre só ele.
  function promote(p) {
    if (MOBILE.matches) setLayout("single", { single: p });
    else { setPrimary(p); setLayout("3d+1"); }
  }

  // Com modelo, o 3D mostra só o plano que está ao lado dele — até o usuário
  // escolher os olhos por conta própria.
  function setPrimary(p) {
    const old = primary;
    primary = p;
    if (!loaded || !hasModel || eyesTouched || old === p) return;
    setPlaneVisible(old, false);
    setPlaneVisible(p, true);
  }

  function setTab(t) {
    tabs.setTab(t);
    onTabChange?.(t);
    if (t === "exam" && !loaded) ensureLoaded();
  }

  // Muda o layout do palco. Qualquer layout com corte baixa o exame antes.
  async function setLayout(next, opts = {}) {
    if (opts.single) single = opts.single;
    if (opts.primary) setPrimary(opts.primary);
    layout = next;
    if (suspended) suspended = null; // escolha explícita do usuário vence
    const needsSlices = next !== "3d" && !(next === "single" && single === "3d");
    if (needsSlices || next === "single") hint.hide();
    applyLayout();
    onLayoutChange?.(next);
    if (needsSlices && !loaded) {
      const ok = await ensureLoaded();
      if (!ok) {
        // Volta para o 3D (no celular, "Uma vista · 3D") e oferece de novo.
        layout = MOBILE.matches ? "single" : "3d";
        single = "3d";
        applyLayout();
        return;
      }
      if (hasModel && !planeOn[primary]) setPlaneVisible(primary, true);
      applyLayout();
    }
  }

  // Estado → atributos. Todo o encaixe é CSS (style.css, bloco EXAME).
  function applyLayout() {
    let l = layout;
    // No desktop não existe "Uma vista": vira só o 3D ou 3D + aquele corte.
    if (!MOBILE.matches && l === "single") {
      if (single !== "3d") setPrimary(single);
      l = single === "3d" ? "3d" : "3d+1";
    }
    const withSlices = loaded && l !== "3d";
    stage.dataset.layout = withSlices || l === "single" ? l : "3d";
    stage.dataset.single = single;
    stage.dataset.mini3d = String(mini3d && l === "single" && single !== "3d");

    for (const p of G.PLANES) {
      let show = false;
      if (withSlices) {
        if (l === "3d+1") show = p === primary;
        else if (l === "3d+3" || l === "quad") show = true;
        else if (l === "single") show = p === single;
      }
      sections[p].hidden = !show;
      sections[p].dataset.primary = String(l === "3d+1" && p === primary);
      if (show) views[p]?.redraw();
    }
    // Celular, "Uma vista" com um corte: o 3D sai (ou vira o mini-3D).
    const hide3d = l === "single" && single !== "3d" && loaded && !mini3d;
    view3d.hidden = hide3d;
    miniOpen.hidden = stage.dataset.mini3d !== "true";
    stage.querySelector('[data-testid="view-tabs"]').hidden = !(probe && l === "single");

    switcher.setLayout(stage.dataset.layout === "single" ? "3d" : stage.dataset.layout);
    mobile.setView(layout === "3d" ? "single" : layout, layout === "3d" ? "3d" : single);
  }

  // Medir e Cortar trabalham só no 3D (o contorno é em coordenadas de tela, e
  // as barras dos modos ficam fixas na janela). Entram forçando o palco só 3D e
  // saem devolvendo o layout que estava.
  function suspend() {
    toolActive = true;
    if (suspended || layout === "3d") return;
    suspended = { layout, single };
    layout = MOBILE.matches ? "single" : "3d";
    single = "3d";
    applyLayout();
  }
  function resume() {
    toolActive = false;
    if (!suspended) return;
    ({ layout, single } = suspended);
    suspended = null;
    applyLayout();
  }

  MOBILE.addEventListener("change", () => {
    // Celular → desktop com "Uma vista": applyLayout já traduz. Desktop →
    // celular: "3d" vira "Uma vista · 3D".
    if (MOBILE.matches && layout === "3d" && probe) { layout = "single"; single = "3d"; }
    applyLayout();
  });

  // ---- API -----------------------------------------------------------------------

  return {
    offer,
    // Caso só com exame: baixa já e abre nos cortes.
    async openExamOnly(p) {
      probe = p;
      series = p.series;
      tabs.show({ hasStructures: false });
      tabs.setTab("exam");
      switcher.show();
      mobile.show();
      const ok = await ensureLoaded();
      if (!ok) return false;
      if (MOBILE.matches) await setLayout("single", { single: "axial" });
      else await setLayout("quad");
      return true;
    },
    setLayout,
    getLayout: () => stage.dataset.layout,
    setTab,
    getTab: () => tabs.getTab(),
    suspend,
    resume,
    isOffered: () => !!probe,
    selectSeries,
    getSeries: () => series.map((s, i) => ({
      label: s.label, primary: s.primary, current: i === current, cached: volCache.has(i),
    })),
    crossWorld: () => (geo ? crossWorld() : null),
    isLoaded: () => loaded,
    ensureLoaded,
    setIndex,
    getIndices: () => ({ ...index }),
    setPlaneVisible,
    getHeader: () => geo && { dims: [...geo.dims], spacing: [...geo.spacing], dir: geo.dir.map((v) => [...v]), origin: [...geo.origin] },
    getAxes: () => ({ ...axes }),
    getWindow: () => ({ ...win }),
    getPreset: () => preset,
    setPreset,
    setWindowLevel,
    isCT: () => ct,
    getLayouts: () => layouts,
    ijkToWorld: (i, j, k) => G.ijkToWorld(geo, i, j, k),
    worldToIjk: (w) => G.worldToIjk(geo, w),
    sliceValueAtWorld(w) {
      const [i, j, k] = G.worldToIjk(geo, w);
      return G.voxelAt(data, geo.dims, i, j, k);
    },
    centerWorld: () => G.ijkToWorld(geo, (geo.dims[0] - 1) / 2, (geo.dims[1] - 1) / 2, (geo.dims[2] - 1) / 2),
    // Geometria, cor ou visibilidade de uma estrutura mudou.
    refreshContours() { segCache.clear(); if (loaded) invalidateAll(); },
    getContour: (p) => (loaded ? contourFor(p, index[p]) : []),
    onExamButton(fn) { examButtonHandler = fn; },
    setExamPressed: (on) => mobile.setExamPressed(on),
    worldBox: () => G.worldBox(geo),
  };
}

function invert(axes) {
  const out = {};
  for (const [plane, axis] of Object.entries(axes)) out[axis] = plane;
  return out;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatMB(bytes) {
  const mb = bytes / 1024 / 1024;
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb < 10 ? mb.toFixed(1).replace(".", ",") : Math.round(mb)} MB`;
}

function formatMm(mm) {
  return `${(Math.round(mm * 100) / 100).toString().replace(".", ",")} mm`;
}

// case/exam-geom.js
// Geometria do exame de imagem (NRRD). Módulo puro: só números e typed arrays —
// nada de DOM, Three.js ou rede. Tudo o que depende de "onde o exame está em
// relação ao 3D" mora aqui, para existir num lugar só.
//
// Convenções (as mesmas do mesh-processor/exam.py, que gera o NRRD):
//   - Índices i, j, k: i varia mais rápido. Voxel (i,j,k) está em
//     data[i + j·ni + k·ni·nj].
//   - `dir[a]` é o vetor (mm, LPS) que se anda ao somar 1 no índice a.
//   - `origin` é o centro do voxel (0,0,0), em LPS.
//   - LPS: +x = esquerda do paciente (L), +y = posterior (P), +z = superior (S).
//
// Alinhamento com o 3D (a única hipótese do módulo, em `ijkToWorld`): o GLB é
// o STL (LPS, como o 3D Slicer exporta) girado −90° em torno de x, sem
// centralizar — ver mesh-processor/processor.py (_RAS_TO_GLTF). Aplicamos a
// mesma rotação ao exame: (x, y, z) → (x, z, −y). Se um dia o backend mudar a
// transformação das malhas, é aqui que se muda a do exame.

export const PLANES = ["axial", "coronal", "sagittal"];

export const PLANE_LABEL = { axial: "Axial", coronal: "Coronal", sagittal: "Sagital" };

// Direção de tela de cada plano, em LPS, na convenção radiológica: o lado
// direito do paciente aparece à esquerda da tela.
//   axial:    direita da tela = L, cima = A (−y)
//   coronal:  direita da tela = L, cima = S
//   sagital:  direita da tela = P (anterior à esquerda), cima = S
// E o eixo anatômico que é a normal de cada plano.
const SCREEN = {
  axial: { right: [1, 0, 0], up: [0, -1, 0], normal: 2 },
  coronal: { right: [1, 0, 0], up: [0, 0, 1], normal: 1 },
  sagittal: { right: [0, 1, 0], up: [0, 0, 1], normal: 0 },
};

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

const SPACE_SIGN = {
  "left-posterior-superior": [1, 1, 1],
  "right-anterior-superior": [-1, -1, 1],
  "left-anterior-superior": [1, -1, 1],
  lps: [1, 1, 1],
  ras: [-1, -1, 1],
  las: [1, -1, 1],
};

// Header do NRRDLoader do three → geometria nossa. Não usamos
// `volume.matrix` do loader: ele ignora `space origin` e aplica o flip LPS→RAS
// do lado errado para o nosso caso.
export function normalizeHeader(header) {
  const dims = header.sizes.slice(0, 3).map(Number);
  const space = String(header.space || "left-posterior-superior").trim().toLowerCase();
  const sign = SPACE_SIGN[space] ?? [1, 1, 1];
  let dir = header.vectors;
  if (!dir) {
    const sp = header.spacings ?? [1, 1, 1];
    dir = [[sp[0], 0, 0], [0, sp[1], 0], [0, 0, sp[2]]];
  }
  dir = dir.slice(0, 3).map((v) => v.slice(0, 3).map((c, t) => Number(c) * sign[t]));
  const o = header.space_origin ?? [0, 0, 0];
  const origin = [0, 1, 2].map((t) => Number(o[t]) * sign[t]);
  const spacing = dir.map(len);
  return { dims, dir, origin, spacing };
}

// ---------------------------------------------------------------------------
// Vetores
// ---------------------------------------------------------------------------

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// LPS → mundo do visualizador (a mesma rotação que o backend aplica às malhas).
export const lpsToWorld = (p) => [p[0], p[2], -p[1]];
export const worldToLps = (w) => [w[0], -w[2], w[1]];

export function ijkToLps(geo, i, j, k) {
  const { dir, origin } = geo;
  return [
    origin[0] + i * dir[0][0] + j * dir[1][0] + k * dir[2][0],
    origin[1] + i * dir[0][1] + j * dir[1][1] + k * dir[2][1],
    origin[2] + i * dir[0][2] + j * dir[1][2] + k * dir[2][2],
  ];
}

export function ijkToWorld(geo, i, j, k) {
  return lpsToWorld(ijkToLps(geo, i, j, k));
}

// Matriz 4×4 (ordem de linhas) de IJK para o mundo, para quem quiser usar
// com THREE.Matrix4.set(...).
export function ijkToWorldMatrix(geo) {
  const c = [0, 1, 2].map((a) => lpsToWorld(geo.dir[a]));
  const o = lpsToWorld(geo.origin);
  return [
    c[0][0], c[1][0], c[2][0], o[0],
    c[0][1], c[1][1], c[2][1], o[1],
    c[0][2], c[1][2], c[2][2], o[2],
    0, 0, 0, 1,
  ];
}

export function worldToIjk(geo, w) {
  const p = worldToLps(w);
  const d = [p[0] - geo.origin[0], p[1] - geo.origin[1], p[2] - geo.origin[2]];
  // Resolve D·[i j k]ᵀ = d, com D = [dir_i dir_j dir_k] em colunas (Cramer).
  const [a, b, c] = geo.dir;
  const det = dot(a, cross(b, c));
  return [
    dot(d, cross(b, c)) / det,
    dot(a, cross(d, c)) / det,
    dot(a, cross(b, d)) / det,
  ];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

// Qual eixo IJK é a normal de cada plano (axial/coronal/sagital). As fatias
// são as que o aparelho adquiriu — sem reamostrar —, então cada plano é
// "o eixo IJK que mais aponta para aquela direção anatômica". Escolhe a
// permutação que maximiza o alinhamento total, para volumes oblíquos a 45°
// não caírem dois planos no mesmo eixo.
export function assignPlaneAxes(geo) {
  const unit = geo.dir.map((v) => scale(v, 1 / len(v)));
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  let best = null;
  let bestScore = -1;
  for (const p of perms) {
    // p[t] = eixo IJK usado como normal do plano PLANES[t]
    const score = PLANES.reduce(
      (s, name, t) => s + Math.abs(unit[p[t]][SCREEN[name].normal]),
      0,
    );
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return { axial: best[0], coronal: best[1], sagittal: best[2] };
}

// Letra de orientação (pt-BR) para uma direção LPS: a componente dominante.
// D = direita, E = esquerda, A = anterior, P = posterior, S = superior, I = inferior.
export function orientationLetter(v) {
  const m = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
  const a = m[0] >= m[1] && m[0] >= m[2] ? 0 : m[1] >= m[2] ? 1 : 2;
  const pos = v[a] >= 0;
  return [pos ? "E" : "D", pos ? "P" : "A", pos ? "S" : "I"][a];
}

// Tudo o que uma vista de corte e o quad 3D precisam saber sobre um plano.
//   axis: eixo IJK normal (o índice que o slider move)
//   h, v: eixos IJK horizontal e vertical na tela
//   flipH: índice h crescente anda para a ESQUERDA da tela
//   flipV: índice v crescente anda para CIMA (a linha 0 da imagem fica embaixo)
//   nh, nv, count: tamanhos; sh, sv: mm por pixel
//   letters: { left, right, top, bottom }
export function planeLayout(geo, name, axes) {
  const axis = axes[name];
  const inPlane = [0, 1, 2].filter((a) => a !== axis);
  const unit = geo.dir.map((v) => scale(v, 1 / len(v)));
  const { right, up } = SCREEN[name];
  // O eixo que mais anda na horizontal da tela vira o horizontal.
  const [h, v] = Math.abs(dot(unit[inPlane[0]], right)) >= Math.abs(dot(unit[inPlane[1]], right))
    ? [inPlane[0], inPlane[1]]
    : [inPlane[1], inPlane[0]];
  const flipH = dot(unit[h], right) < 0;
  const flipV = dot(unit[v], up) > 0;
  const screenRight = scale(unit[h], flipH ? -1 : 1);
  const screenUp = scale(unit[v], flipV ? 1 : -1);
  return {
    name,
    axis,
    h,
    v,
    flipH,
    flipV,
    nh: geo.dims[h],
    nv: geo.dims[v],
    count: geo.dims[axis],
    sh: geo.spacing[h],
    sv: geo.spacing[v],
    letters: {
      right: orientationLetter(screenRight),
      left: orientationLetter(scale(screenRight, -1)),
      top: orientationLetter(screenUp),
      bottom: orientationLetter(scale(screenUp, -1)),
    },
  };
}

// Os 4 cantos (mundo) da fatia `index`, na borda dos voxels, na ordem que casa
// com as coordenadas de textura (0,0) (1,0) (1,1) (0,1): (h,v) = (−½,−½),
// (nh−½,−½), (nh−½,nv−½), (−½,nv−½). A linha 0 da imagem é v = 0.
export function sliceCorners(geo, layout, index) {
  const { axis, h, v, nh, nv } = layout;
  const at = (hh, vv) => {
    const ijk = [0, 0, 0];
    ijk[axis] = index;
    ijk[h] = hh;
    ijk[v] = vv;
    return ijkToWorld(geo, ijk[0], ijk[1], ijk[2]);
  };
  return [at(-0.5, -0.5), at(nh - 0.5, -0.5), at(nh - 0.5, nv - 0.5), at(-0.5, nv - 0.5)];
}

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

// Fatia `index` do plano → cinza RGBA em `out` (Uint32Array de nh·nv, pixel
// (h, v) em out[v·nh + h]). Janela linear [lo, hi] → [0, 255].
export function extractSlice(data, dims, layout, index, lo, hi, out) {
  const stride = [1, dims[0], dims[0] * dims[1]];
  const sa = stride[layout.axis], sh = stride[layout.h], sv = stride[layout.v];
  const { nh, nv } = layout;
  const base = index * sa;
  const k = 255 / Math.max(hi - lo, 1e-6);
  let p = 0;
  for (let y = 0; y < nv; y++) {
    let src = base + y * sv;
    for (let x = 0; x < nh; x++, src += sh) {
      let g = (data[src] - lo) * k;
      g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
      // Little-endian: R no byte baixo. R = G = B = g, A = 255.
      out[p++] = 0xff000000 | (g << 16) | (g << 8) | g;
    }
  }
}

// Janela automática: percentis 0,5 % e 99,5 % de uma amostra dos voxels,
// por histograma (sem ordenar milhões de números). Ignora o fundo exatamente
// zero quando ele domina (RM tem muito ar), para o contraste ficar no corpo.
export function autoWindow(data, step = 7) {
  let min = Infinity, max = -Infinity;
  for (let t = 0; t < data.length; t += step) {
    const x = data[t];
    if (x < min) min = x;
    if (x > max) max = x;
  }
  if (!(max > min)) return { lo: min, hi: min + 1 };
  const BINS = 4096;
  const hist = new Uint32Array(BINS);
  const f = (BINS - 1) / (max - min);
  let n = 0, zeros = 0;
  for (let t = 0; t < data.length; t += step) {
    const x = data[t];
    if (x === 0) zeros++;
    hist[((x - min) * f) | 0]++;
    n++;
  }
  // Fundo zero dominante: tira da conta.
  const zeroBin = ((0 - min) * f) | 0;
  if (min <= 0 && max >= 0 && zeros > n * 0.3) {
    hist[zeroBin] -= zeros;
    n -= zeros;
  }
  const pick = (q) => {
    const target = q * n;
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b];
      if (acc >= target) return min + b / f;
    }
    return max;
  };
  const lo = pick(0.005), hi = pick(0.995);
  return hi > lo ? { lo, hi } : { lo: min, hi: max };
}

// ---- Janela de TC -----------------------------------------------------------------
// TC chega em unidades Hounsfield (o mesh-processor aplica RescaleSlope/
// Intercept), então janelas clínicas fixas valem para qualquer TC. Janela =
// largura, nível = centro. RM não tem escala absoluta: fica na automática.
export const CT_PRESETS = [
  { id: "soft", label: "Partes moles", width: 400, level: 40 },
  { id: "vessels", label: "Vasos", width: 600, level: 150 },
  { id: "bone", label: "Osso", width: 1800, level: 400 },
  { id: "lung", label: "Pulmão", width: 1500, level: -600 },
];

// É TC em Hounsfield? Decide pelos valores, sem nenhum campo do DICOM: ar fica
// perto de −1000 HU (≥ 1 % da amostra abaixo de −900) e tecido/contraste passa
// de 100. RM não tem valor negativo.
export function isHounsfield(data, step = 7) {
  let n = 0, air = 0, max = -Infinity;
  for (let t = 0; t < data.length; t += step) {
    const x = data[t];
    if (x <= -900) air++;
    if (x > max) max = x;
    n++;
  }
  return n > 0 && air / n >= 0.01 && max >= 100;
}

export const windowFromLevel = (width, level) => ({ lo: level - width / 2, hi: level + width / 2 });
export const levelOf = (win) => ({ width: win.hi - win.lo, level: (win.lo + win.hi) / 2 });

// Brilho e contraste (0–100, 50 = a janela de base: preset, digitada ou automática) → janela.
// Brilho sobe → centro desce (a imagem clareia). Contraste sobe → janela estreita.
export function windowFromControls(auto, brightness, contrast) {
  const c0 = (auto.lo + auto.hi) / 2;
  const w0 = auto.hi - auto.lo;
  const c = c0 - ((brightness - 50) / 50) * w0;
  const w = w0 * Math.pow(2, -(contrast - 50) / 25);
  return { lo: c - w / 2, hi: c + w / 2 };
}

export function voxelAt(data, dims, i, j, k) {
  const ii = Math.round(i), jj = Math.round(j), kk = Math.round(k);
  if (ii < 0 || jj < 0 || kk < 0 || ii >= dims[0] || jj >= dims[1] || kk >= dims[2]) return null;
  return data[ii + jj * dims[0] + kk * dims[0] * dims[1]];
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

// Encaixa a fatia (tamanho físico nh·sh × nv·sv mm) numa caixa W×H de CSS px,
// mantendo a proporção. Devolve o retângulo e a escala em px/mm.
export function fitSlice(layout, W, H) {
  const wmm = layout.nh * layout.sh;
  const hmm = layout.nv * layout.sv;
  const k = Math.min(W / wmm, H / hmm);
  const w = wmm * k, h = hmm * k;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h, pxPerMm: k };
}

// Índice (h, v) contínuo, em unidades de voxel, → ponto na vista (CSS px).
export function voxelToScreen(layout, rect, h, v) {
  const u = (h + 0.5) / layout.nh;
  const t = (v + 0.5) / layout.nv;
  return [
    rect.x + (layout.flipH ? 1 - u : u) * rect.w,
    rect.y + (layout.flipV ? 1 - t : t) * rect.h,
  ];
}

export function screenToVoxel(layout, rect, x, y) {
  let u = (x - rect.x) / rect.w;
  let t = (y - rect.y) / rect.h;
  if (layout.flipH) u = 1 - u;
  if (layout.flipV) t = 1 - t;
  return [u * layout.nh - 0.5, t * layout.nv - 0.5];
}

// Barra de escala: o maior comprimento "redondo" que cabe em ¼ da largura.
export function scaleBar(pxPerMm, maxPx) {
  const options = [100, 50, 20, 10, 5, 2, 1];
  for (const mm of options) {
    if (mm * pxPerMm <= maxPx) return { mm, px: mm * pxPerMm, label: mm >= 10 ? `${mm / 10} cm` : `${mm} mm` };
  }
  return { mm: 1, px: pxPerMm, label: "1 mm" };
}

// Caixa (mundo) que envolve o volume inteiro — para enquadrar a câmera quando
// o caso não tem modelo 3D.
export function worldBox(geo) {
  const [ni, nj, nk] = geo.dims;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const i of [-0.5, ni - 0.5]) for (const j of [-0.5, nj - 0.5]) for (const k of [-0.5, nk - 0.5]) {
    const p = ijkToWorld(geo, i, j, k);
    for (let t = 0; t < 3; t++) { min[t] = Math.min(min[t], p[t]); max[t] = Math.max(max[t], p[t]); }
  }
  return { min, max };
}


// ---------------------------------------------------------------------------
// Contorno das estruturas sobre o corte
// ---------------------------------------------------------------------------

// Posições (mundo, Float32Array xyz) → índices contínuos (i, j, k). Feito uma
// vez por malha; depois cortar por um plano IJK é comparar uma coordenada.
export function worldArrayToIjk(geo, positions) {
  // Inversa de D = [dir_i dir_j dir_k] (colunas) pré-calculada: as linhas da
  // inversa são (b×c, c×a, a×b)/det.
  const [a, b, c] = geo.dir;
  const det = dot(a, cross(b, c));
  const r0 = scale(cross(b, c), 1 / det), r1 = scale(cross(c, a), 1 / det), r2 = scale(cross(a, b), 1 / det);
  const [ox, oy, oz] = geo.origin;
  const out = new Float32Array(positions.length);
  for (let t = 0; t < positions.length; t += 3) {
    // mundo → LPS: (x, y, z) → (x, −z, y); depois tira a origem.
    const x = positions[t] - ox, y = -positions[t + 2] - oy, z = positions[t + 1] - oz;
    out[t] = r0[0] * x + r0[1] * y + r0[2] * z;
    out[t + 1] = r1[0] * x + r1[1] * y + r1[2] * z;
    out[t + 2] = r2[0] * x + r2[1] * y + r2[2] * z;
  }
  return out;
}

// Interseção da malha com o plano ijk[axis] = n. Devolve os segmentos em
// coordenadas (h, v) da vista, como pares consecutivos [h0,v0,h1,v1, ...]
// num Float32Array. Triângulo que só encosta no plano é ignorado.
export function meshPlaneSegments(ijk, indices, axis, h, v, n) {
  const out = [];
  const triCount = indices ? indices.length / 3 : ijk.length / 9;
  const vid = indices ? (t) => indices[t] : (t) => t;
  for (let t = 0; t < triCount; t++) {
    const a = vid(3 * t) * 3, b = vid(3 * t + 1) * 3, c = vid(3 * t + 2) * 3;
    const da = ijk[a + axis] - n, db = ijk[b + axis] - n, dc = ijk[c + axis] - n;
    if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
    let found = 0;
    const edge = (p, dp, q, dq) => {
      if ((dp > 0) === (dq > 0) || dp === dq) return;
      const s = dp / (dp - dq);
      out.push(ijk[p + h] + s * (ijk[q + h] - ijk[p + h]), ijk[p + v] + s * (ijk[q + v] - ijk[p + v]));
      found++;
    };
    edge(a, da, b, db);
    edge(b, db, c, dc);
    if (found < 2) edge(c, dc, a, da);
    if (found === 1) out.length -= 2; // só tocou num vértice
  }
  return new Float32Array(out);
}

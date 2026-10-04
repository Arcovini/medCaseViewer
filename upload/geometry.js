// upload/geometry.js
// Onde um volume fica no espaço do paciente, para saber se uma segmentação foi
// desenhada na série de exame que veio com ela. Puro: sem DOM, sem rede.
//
// Geometria = { dirs, origin, lo, hi } em LPS e mm: o centro do voxel (i, j, k)
// fica em origin + i·dirs[0] + j·dirs[1] + k·dirs[2], com índices de lo a hi.
// É a mesma leitura do backend (exam.py, segmentation.py) e do visualizador
// (exam-geom.ijkToWorld).
//
// Por que importa: o 3D de uma segmentação cai onde ela foi desenhada. Se o
// exame enviado é outra aquisição (outra fase, outra sequência de RM, o feto
// mexeu), o 3D não fica em cima dos cortes, e nada no caso diz por quê.

// Sinal de cada eixo para levar o `space` do NRRD a LPS (como exam._SPACES).
const SPACE_SIGNS = {
  "left-posterior-superior": [1, 1, 1], lps: [1, 1, 1],
  "right-anterior-superior": [-1, -1, 1], ras: [-1, -1, 1],
  "left-anterior-superior": [1, -1, 1], las: [1, -1, 1],
};

// Mesma grade: os cantos coincidem a menos disto (mm). Folga para o arredondamento
// das posições do DICOM; uma série de outra aquisição erra por centímetros.
export const SAME_GRID_MM = 0.5;
// Menos que isto da caixa da máscara dentro do exame: o 3D cai fora dos cortes.
export const MIN_INSIDE = 0.5;

const vec = (s) => {
  const v = s.split(",").map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? v : null;
};

// Cabeçalho do NRRD ({ campo: valor }, nomes em minúsculas) → geometria, ou null.
// O eixo "none" (as camadas de uma segmentação do Slicer) não é espacial.
export function nrrdGeometry(fields) {
  const sign = SPACE_SIGNS[(fields.space || "").trim().toLowerCase()];
  if (!sign) return null;
  const sizes = (fields.sizes || "").trim().split(/\s+/).map(Number);
  const tokens = (fields["space directions"] || "").match(/none|\([^)]*\)/gi) || [];
  if (tokens.length !== sizes.length) return null;
  const dirs = [];
  const counts = [];
  for (let a = 0; a < tokens.length; a++) {
    if (/^none$/i.test(tokens[a])) continue;
    const v = vec(tokens[a].slice(1, -1));
    if (!v) return null;
    dirs.push(v.map((x, c) => x * sign[c]));
    counts.push(sizes[a]);
  }
  const o = /^\(([^)]*)\)$/.exec((fields["space origin"] || "").trim());
  const origin = o && vec(o[1]);
  if (dirs.length !== 3 || !origin || counts.some((n) => !(n >= 1))) return null;
  return { dirs, origin: origin.map((x, c) => x * sign[c]), lo: [0, 0, 0], hi: counts.map((n) => n - 1) };
}

// O .seg.nrrd do 3D Slicer guarda a geometria do volume em que foi desenhado em
// Segmentation_ConversionParameters, item "Reference image geometry": a matriz
// 4×4 índice → RAS por linhas e a extensão i0 i1 j0 j1 k0 k1, separados por ";".
export function slicerReferenceGeometry(conversionParameters) {
  const m = /(?:^|&)Reference image geometry\|([^|]*)\|/.exec(conversionParameters || "");
  if (!m) return null;
  const v = m[1].split(";").filter((s) => s.trim() !== "").map(Number);
  if (v.length !== 22 || v.some((x) => !Number.isFinite(x))) return null;
  const ras = [-1, -1, 1]; // RAS → LPS
  const dirs = [0, 1, 2].map((c) => [0, 1, 2].map((r) => v[r * 4 + c] * ras[r]));
  const origin = [0, 1, 2].map((r) => v[r * 4 + 3] * ras[r]);
  const lo = [v[16], v[18], v[20]];
  const hi = [v[17], v[19], v[21]];
  if (hi.some((h, a) => h < lo[a])) return null;
  return { dirs, origin, lo, hi };
}

// Série DICOM (dicom-series.js, fatias já em ordem de posição) → geometria, como
// exam.py: i = IOP[0:3]·PixelSpacing[1], j = IOP[3:6]·PixelSpacing[0],
// k = (IPP_último − IPP_primeiro)/(n−1), origem = IPP da primeira.
export function dicomGeometry(s) {
  const n = s?.slices?.length;
  if (!n || n < 2 || !s.iop || !s.ps || !s.rows || !s.cols || s.slices.some((sl) => !sl.ipp)) return null;
  const first = s.slices[0].ipp;
  const last = s.slices[n - 1].ipp;
  return {
    dirs: [
      s.iop.slice(0, 3).map((x) => x * s.ps[1]),
      s.iop.slice(3, 6).map((x) => x * s.ps[0]),
      first.map((x, c) => (last[c] - x) / (n - 1)),
    ],
    origin: first.slice(),
    lo: [0, 0, 0],
    hi: [s.cols - 1, s.rows - 1, n - 1],
  };
}

export function toWorld(g, ijk) {
  return [0, 1, 2].map((c) => g.origin[c] + ijk[0] * g.dirs[0][c] + ijk[1] * g.dirs[1][c] + ijk[2] * g.dirs[2][c]);
}

const det3 = (u, v, w) =>
  u[0] * (v[1] * w[2] - v[2] * w[1]) - v[0] * (u[1] * w[2] - u[2] * w[1]) + w[0] * (u[1] * v[2] - u[2] * v[1]);

// Mundo → índice (contínuo): resolve p − origin = i·dirs[0] + j·dirs[1] + k·dirs[2]
// por Cramer.
function toIndex(g, p) {
  const det = det3(...g.dirs);
  if (!det) return null;
  const d = p.map((x, c) => x - g.origin[c]);
  return [0, 1, 2].map((a) => {
    const cols = g.dirs.slice();
    cols[a] = d;
    return det3(...cols) / det;
  });
}

function corners(g, lo = g.lo, hi = g.hi) {
  const out = [];
  for (const i of [lo[0], hi[0]]) for (const j of [lo[1], hi[1]]) for (const k of [lo[2], hi[2]]) out.push(toWorld(g, [i, j, k]));
  return out;
}

const counts = (g) => g.hi.map((h, a) => h - g.lo[a] + 1).sort((x, y) => x - y);

// Mesma grade de voxels no espaço do paciente: o mesmo número de voxels por eixo
// e os 8 cantos nos mesmos lugares. Não depende da ordem nem do sentido dos eixos
// (o Slicer e o DICOM podem empilhar as fatias ao contrário um do outro).
export function sameGrid(a, b, tol = SAME_GRID_MM) {
  if (!a || !b) return false;
  const na = counts(a), nb = counts(b);
  if (na.some((n, i) => n !== nb[i])) return false;
  const cb = corners(b);
  return corners(a).every((p) => cb.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= tol));
}

// Fração da caixa da máscara (índices da segmentação) que cai dentro do volume
// do exame. Aproximada pela caixa alinhada aos eixos do exame que contém a da
// máscara: basta para separar "dentro" de "do outro lado do corpo".
export function insideFraction(segGeom, box, examGeom) {
  const lo = box.lo.map((x) => x - 0.5);
  const hi = box.hi.map((x) => x + 0.5);
  const pts = corners(segGeom, lo, hi).map((p) => toIndex(examGeom, p));
  if (pts.some((p) => !p)) return null;
  let total = 1, inside = 1;
  for (let a = 0; a < 3; a++) {
    const min = Math.min(...pts.map((p) => p[a]));
    const max = Math.max(...pts.map((p) => p[a]));
    const elo = examGeom.lo[a] - 0.5, ehi = examGeom.hi[a] + 0.5;
    total *= Math.max(max - min, 1e-9);
    inside *= Math.max(0, Math.min(max, ehi) - Math.max(min, elo));
  }
  return inside / total;
}

// Uma segmentação ({ geometry, reference, box }, nrrd-kind.js) contra a série do
// exame em que as estruturas vão se alinhar ({ geometry }):
//   "same"    — desenhada nesta série;
//   "other"   — outra grade, mas a máscara cai dentro do exame (outra fase,
//               outra sequência, outro recorte): o 3D pode ficar deslocado;
//   "outside" — a máscara cai fora do exame;
//   null      — não dá para saber (geometria ilegível, .zip opaco).
export function pairing(seg, examGeom) {
  const ref = seg?.reference || seg?.geometry;
  if (!ref || !examGeom) return null;
  if (sameGrid(ref, examGeom)) return "same";
  if (seg.geometry && seg.box) {
    const f = insideFraction(seg.geometry, seg.box, examGeom);
    if (f != null && f < MIN_INSIDE) return "outside";
  }
  return "other";
}

// case-next/calibre-geom.js
// Math puro para o modo Calibre. Não toca DOM, não importa world.
// Recebe THREE pra construir Vector3 mas não acessa scene/renderer.
//
// Conteúdo:
//  • crossSection(soup, origin, normal)        → polígonos (multi-lumen aware)
//  • polygonArea(polygon, normal)              → área planar
//  • polygonCentroid(polygon)                  → centroide
//  • pcaJacobi(points)                         → autovalores/vetores 3×3
//  • extractCenterline({…})                    → marcha local P1[→P2]
//  • diameterAt(soup, C, tangent)              → diâmetro equivalente
//  • pickNearestSegment(screenPts, x, y, thr)  → screen-space line picking

import * as THREE from "three";

// ===========================================================================
// Constantes
// ===========================================================================

const EPSILON = 1e-6;
const QUANTIZE = 1e4;                  // 1/0.0001 mm pra parear endpoints

// Marcha
const MARCH_MAX_STEPS = 30;
const MARCH_STEP_MIN_MM = 1.0;
const MARCH_STEP_MAX_MM = 3.0;
const STEP_TO_DIAMETER_RATIO = 0.25;
const PCA_RADIUS_MULT = 2.0;
const PCA_MIN_POINTS = 20;
const TUBULARITY_THRESHOLD = 0.6;      // λ1/λ0 — abaixo é tubular o suficiente
const SMOOTH_BLEND = 0.6;
const AREA_GROWTH_LIMIT = 4.0;
const P2_PROXIMITY_DIAM_MULT = 2.0;
const P2_UNREACHED_DIAM_MULT = 3.0;
const MIN_VALID_AREA_MM2 = 0.01;

// Jacobi
const JACOBI_MAX_SWEEPS = 30;
const JACOBI_EPSILON = 1e-10;

// ===========================================================================
// Scratch buffers (evita GC em loops quentes)
// ===========================================================================

const _e0 = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _tmp = new THREE.Vector3();

// ===========================================================================
// Triangle-plane intersection
// ===========================================================================

function quantKey(v) {
  return (
    Math.round(v.x * QUANTIZE) + "_" +
    Math.round(v.y * QUANTIZE) + "_" +
    Math.round(v.z * QUANTIZE)
  );
}

// Recorta triangle soup por plano. Retorna array de polígonos fechados
// (cada um = array de Vector3, fecho implícito — último != primeiro).
// soup: { positions: Float32Array em world-space, indices?: Uint32Array }
export function crossSection(soup, planeOrigin, planeNormal) {
  const { positions, indices } = soup;
  const triCount = indices ? indices.length / 3 : positions.length / 9;
  const segments = [];

  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2;
    if (indices) {
      i0 = indices[t * 3] * 3;
      i1 = indices[t * 3 + 1] * 3;
      i2 = indices[t * 3 + 2] * 3;
    } else {
      i0 = t * 9;
      i1 = t * 9 + 3;
      i2 = t * 9 + 6;
    }

    _e0.set(positions[i0], positions[i0 + 1], positions[i0 + 2]);
    _e1.set(positions[i1], positions[i1 + 1], positions[i1 + 2]);
    _e2.set(positions[i2], positions[i2 + 1], positions[i2 + 2]);

    const d0 = _tmp.copy(_e0).sub(planeOrigin).dot(planeNormal);
    const d1 = _tmp.copy(_e1).sub(planeOrigin).dot(planeNormal);
    const d2 = _tmp.copy(_e2).sub(planeOrigin).dot(planeNormal);

    if ((d0 > EPSILON && d1 > EPSILON && d2 > EPSILON) ||
        (d0 < -EPSILON && d1 < -EPSILON && d2 < -EPSILON)) continue;

    const pts = [];
    _addEdgeIntersection(_e0, _e1, d0, d1, pts);
    _addEdgeIntersection(_e1, _e2, d1, d2, pts);
    _addEdgeIntersection(_e2, _e0, d2, d0, pts);

    if (pts.length === 2) segments.push([pts[0], pts[1]]);
    // 0 / 1 / 3+ pontos: degenerado (triângulo tangente). Ignora.
  }

  return _chainSegments(segments);
}

function _addEdgeIntersection(va, vb, da, db, out) {
  if (da * db > 0) return;
  if (Math.abs(da) < EPSILON && Math.abs(db) < EPSILON) return;
  if (Math.abs(da) < EPSILON) { out.push(va.clone()); return; }
  if (Math.abs(db) < EPSILON) { out.push(vb.clone()); return; }
  const t = da / (da - db);
  out.push(new THREE.Vector3().lerpVectors(va, vb, t));
}

function _chainSegments(segments) {
  if (segments.length === 0) return [];

  const hash = new Map();
  for (let i = 0; i < segments.length; i++) {
    const ka = quantKey(segments[i][0]);
    const kb = quantKey(segments[i][1]);
    if (!hash.has(ka)) hash.set(ka, []);
    if (!hash.has(kb)) hash.set(kb, []);
    hash.get(ka).push({ segIdx: i, end: 0 });
    hash.get(kb).push({ segIdx: i, end: 1 });
  }

  const visited = new Array(segments.length).fill(false);
  const polygons = [];

  for (let start = 0; start < segments.length; start++) {
    if (visited[start]) continue;
    const poly = [segments[start][0].clone()];
    let curSegIdx = start;
    let curEnd = 1;

    let safety = segments.length + 10;
    while (safety-- > 0) {
      if (visited[curSegIdx]) break;
      visited[curSegIdx] = true;

      const next = segments[curSegIdx][curEnd];
      poly.push(next.clone());

      const key = quantKey(next);
      const cands = hash.get(key) || [];
      let found = null;
      for (const c of cands) {
        if (!visited[c.segIdx]) { found = c; break; }
      }
      if (!found) break;
      curSegIdx = found.segIdx;
      curEnd = 1 - found.end;

      if (poly.length > 2 && quantKey(poly[0]) === quantKey(poly[poly.length - 1])) {
        poly.pop();   // remove duplicado de fecho
        break;
      }
    }

    if (poly.length >= 3) polygons.push(poly);
  }

  return polygons;
}

// ===========================================================================
// Polygon utils
// ===========================================================================

export function polygonArea(polygon, planeNormal) {
  if (polygon.length < 3) return 0;
  const sum = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    c.crossVectors(a, b);
    sum.add(c);
  }
  return Math.abs(sum.dot(planeNormal)) * 0.5;
}

export function polygonCentroid(polygon) {
  const c = new THREE.Vector3();
  if (polygon.length === 0) return c;
  for (const p of polygon) c.add(p);
  c.divideScalar(polygon.length);
  return c;
}

// ===========================================================================
// PCA via Jacobi (3×3 symmetric eigendecomp)
// ===========================================================================

export function pcaJacobi(points) {
  if (points.length < 4) return null;

  const centroid = new THREE.Vector3();
  for (const p of points) centroid.add(p);
  centroid.divideScalar(points.length);

  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
  for (const p of points) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dz = p.z - centroid.z;
    cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
    cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
  }
  const n = points.length;
  cxx /= n; cyy /= n; czz /= n; cxy /= n; cxz /= n; cyz /= n;

  // Diagonais e off-diagonais (matriz simétrica)
  let a00 = cxx, a11 = cyy, a22 = czz;
  let a01 = cxy, a02 = cxz, a12 = cyz;
  // V começa como identidade (colunas serão autovetores)
  let v00 = 1, v01 = 0, v02 = 0;
  let v10 = 0, v11 = 1, v12 = 0;
  let v20 = 0, v21 = 0, v22 = 1;

  for (let sweep = 0; sweep < JACOBI_MAX_SWEEPS; sweep++) {
    const off = Math.abs(a01) + Math.abs(a02) + Math.abs(a12);
    if (off < JACOBI_EPSILON) break;

    let pq;
    if (Math.abs(a01) >= Math.abs(a02) && Math.abs(a01) >= Math.abs(a12)) pq = 0;
    else if (Math.abs(a02) >= Math.abs(a12)) pq = 1;
    else pq = 2;

    let app, aqq, apq;
    if (pq === 0) { app = a00; aqq = a11; apq = a01; }
    else if (pq === 1) { app = a00; aqq = a22; apq = a02; }
    else { app = a11; aqq = a22; apq = a12; }

    const theta = (aqq - app) / (2 * apq);
    let t;
    if (theta === 0) t = 1;
    else if (Math.abs(theta) > 1e10) t = 1 / (2 * theta);
    else t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;

    const new_app = app - t * apq;
    const new_aqq = aqq + t * apq;
    if (pq === 0) { a00 = new_app; a11 = new_aqq; a01 = 0;
                    const ap = a02, aq = a12;
                    a02 = c * ap - s * aq; a12 = s * ap + c * aq;
                    const t0 = v00, t1 = v10, t2 = v20;
                    const u0 = v01, u1 = v11, u2 = v21;
                    v00 = c * t0 - s * u0; v01 = s * t0 + c * u0;
                    v10 = c * t1 - s * u1; v11 = s * t1 + c * u1;
                    v20 = c * t2 - s * u2; v21 = s * t2 + c * u2; }
    else if (pq === 1) { a00 = new_app; a22 = new_aqq; a02 = 0;
                         const ap = a01, aq = a12;
                         a01 = c * ap - s * aq; a12 = s * ap + c * aq;
                         const t0 = v00, t1 = v10, t2 = v20;
                         const u0 = v02, u1 = v12, u2 = v22;
                         v00 = c * t0 - s * u0; v02 = s * t0 + c * u0;
                         v10 = c * t1 - s * u1; v12 = s * t1 + c * u1;
                         v20 = c * t2 - s * u2; v22 = s * t2 + c * u2; }
    else { a11 = new_app; a22 = new_aqq; a12 = 0;
           const ap = a01, aq = a02;
           a01 = c * ap - s * aq; a02 = s * ap + c * aq;
           const t0 = v01, t1 = v11, t2 = v21;
           const u0 = v02, u1 = v12, u2 = v22;
           v01 = c * t0 - s * u0; v02 = s * t0 + c * u0;
           v11 = c * t1 - s * u1; v12 = s * t1 + c * u1;
           v21 = c * t2 - s * u2; v22 = s * t2 + c * u2; }
  }

  const eigs = [
    { val: a00, vec: new THREE.Vector3(v00, v10, v20) },
    { val: a11, vec: new THREE.Vector3(v01, v11, v21) },
    { val: a22, vec: new THREE.Vector3(v02, v12, v22) },
  ];
  eigs.sort((a, b) => b.val - a.val);
  return {
    eigenvalues: [eigs[0].val, eigs[1].val, eigs[2].val],
    eigenvectors: [eigs[0].vec.normalize(), eigs[1].vec.normalize(), eigs[2].vec.normalize()],
    centroid,
  };
}

// ===========================================================================
// Centerline marching
// ===========================================================================

// raycastInternal: função(origin: Vec3, dir: Vec3) → Vec3 | null
//   Cabe ao caller usar THREE.Raycaster contra um mesh específico, oferecendo
//   o ponto da "outra parede" do vaso. Se mesh é aberto ou origin já está
//   fora, deve retornar null.
//
// P1_normal e P2_normal: world-space, já transformados pela matrixNormal.
export function extractCenterline({ soup, P1, P1_normal, P2 = null, P2_normal = null, raycastInternal }) {
  const inwardDir = P1_normal.clone().multiplyScalar(-1).normalize();
  const P1_opp = raycastInternal(P1, inwardDir);
  if (!P1_opp) return null;

  const C0 = new THREE.Vector3().addVectors(P1, P1_opp).multiplyScalar(0.5);
  const diameter0 = P1.distanceTo(P1_opp);

  let P2_opp = null;
  let C2 = null;
  if (P2 && P2_normal) {
    const inward2 = P2_normal.clone().multiplyScalar(-1).normalize();
    P2_opp = raycastInternal(P2, inward2);
    if (P2_opp) C2 = new THREE.Vector3().addVectors(P2, P2_opp).multiplyScalar(0.5);
  }

  // PCA local pra tangente inicial
  const radius = PCA_RADIUS_MULT * diameter0;
  const radiusSq = radius * radius;
  const pcaPoints = [];
  const positions = soup.positions;
  const vertCount = positions.length / 3;
  for (let i = 0; i < vertCount; i++) {
    const dx = positions[i * 3] - C0.x;
    const dy = positions[i * 3 + 1] - C0.y;
    const dz = positions[i * 3 + 2] - C0.z;
    if (dx * dx + dy * dy + dz * dz <= radiusSq) {
      pcaPoints.push(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
    }
  }
  if (pcaPoints.length < PCA_MIN_POINTS) {
    return {
      points: [C0.clone()],
      P1_opp, diameter0,
      tangent0: P1_normal.clone(),
      isTubular: false,
      fallback: "none",
      warning: "Vizinhança insuficiente para estimar a direção do vaso.",
    };
  }
  const pca = pcaJacobi(pcaPoints);
  if (!pca) {
    return {
      points: [C0.clone()],
      P1_opp, diameter0,
      tangent0: P1_normal.clone(),
      isTubular: false,
      fallback: "none",
      warning: "Não foi possível estimar a direção do vaso.",
    };
  }
  const tubularity = pca.eigenvalues[1] / Math.max(pca.eigenvalues[0], EPSILON);
  const isTubular = tubularity < TUBULARITY_THRESHOLD;

  let tangent = pca.eigenvectors[0].clone().normalize();
  if (C2 && tangent.dot(_tmp.subVectors(C2, C0)) < 0) {
    tangent.multiplyScalar(-1);
  }

  const stepSize = Math.min(MARCH_STEP_MAX_MM, Math.max(MARCH_STEP_MIN_MM, diameter0 * STEP_TO_DIAMETER_RATIO));
  const tangent0 = tangent.clone();

  // Forward march
  const forward = [C0.clone()];
  {
    let prevArea = null;
    let cCur = C0.clone();
    let vCur = tangent.clone();
    for (let s = 0; s < MARCH_MAX_STEPS; s++) {
      const guess = new THREE.Vector3().copy(cCur).addScaledVector(vCur, stepSize);
      const polys = crossSection(soup, guess, vCur);
      if (polys.length === 0) break;

      let bestPoly = null;
      let bestDist = Infinity;
      for (const poly of polys) {
        const cen = polygonCentroid(poly);
        const d = cen.distanceTo(cCur);
        if (d < bestDist) { bestDist = d; bestPoly = poly; }
      }
      if (!bestPoly) break;

      const area = polygonArea(bestPoly, vCur);
      if (area < MIN_VALID_AREA_MM2) break;
      if (prevArea !== null && area > AREA_GROWTH_LIMIT * prevArea) break;

      const cNew = polygonCentroid(bestPoly);
      const vNew = new THREE.Vector3().subVectors(cNew, cCur);
      if (vNew.lengthSq() < EPSILON) break;
      vNew.normalize();
      vCur.lerp(vNew, SMOOTH_BLEND).normalize();
      cCur.copy(cNew);
      forward.push(cCur.clone());
      prevArea = area;

      if (C2 && cCur.distanceTo(C2) < P2_PROXIMITY_DIAM_MULT * diameter0) break;
    }
  }

  // Backward march (apenas se sem P2)
  const backward = [];
  if (!C2) {
    let prevArea = null;
    let cCur = C0.clone();
    let vCur = tangent0.clone().multiplyScalar(-1).normalize();
    for (let s = 0; s < MARCH_MAX_STEPS; s++) {
      const guess = new THREE.Vector3().copy(cCur).addScaledVector(vCur, stepSize);
      const polys = crossSection(soup, guess, vCur);
      if (polys.length === 0) break;

      let bestPoly = null;
      let bestDist = Infinity;
      for (const poly of polys) {
        const cen = polygonCentroid(poly);
        const d = cen.distanceTo(cCur);
        if (d < bestDist) { bestDist = d; bestPoly = poly; }
      }
      if (!bestPoly) break;

      const area = polygonArea(bestPoly, vCur);
      if (area < MIN_VALID_AREA_MM2) break;
      if (prevArea !== null && area > AREA_GROWTH_LIMIT * prevArea) break;

      const cNew = polygonCentroid(bestPoly);
      const vNew = new THREE.Vector3().subVectors(cNew, cCur);
      if (vNew.lengthSq() < EPSILON) break;
      vNew.normalize();
      vCur.lerp(vNew, SMOOTH_BLEND).normalize();
      cCur.copy(cNew);
      backward.push(cCur.clone());
      prevArea = area;
    }
    backward.reverse();
  }

  let fallback = "none";
  const fullPoints = [...backward, ...forward];

  if (C2) {
    const lastPoint = fullPoints[fullPoints.length - 1];
    if (lastPoint.distanceTo(C2) > P2_UNREACHED_DIAM_MULT * diameter0) {
      fallback = "straight";
    }
    fullPoints.push(C2.clone());
  }

  return {
    points: fullPoints,
    P1_opp,
    P2_opp,
    diameter0,
    tangent0,
    isTubular,
    fallback,
  };
}

// ===========================================================================
// Diâmetro num ponto
// ===========================================================================

export function diameterAt(soup, C, tangent) {
  const polys = crossSection(soup, C, tangent);
  if (polys.length === 0) return null;
  let bestPoly = null;
  let bestDist = Infinity;
  for (const poly of polys) {
    const cen = polygonCentroid(poly);
    const d = cen.distanceTo(C);
    if (d < bestDist) { bestDist = d; bestPoly = poly; }
  }
  if (!bestPoly) return null;
  const area = polygonArea(bestPoly, tangent);
  if (area < MIN_VALID_AREA_MM2) return null;
  return {
    diameter: 2 * Math.sqrt(area / Math.PI),
    polygon: bestPoly,
  };
}

// ===========================================================================
// Screen-space line picking
// ===========================================================================

// screenPoints: array de {x, y} já projetados pra pixel coords.
// Retorna { segmentIndex, t, distance } ou null se nada dentro de `threshold`.
export function pickNearestSegment(screenPoints, x, y, threshold = 22) {
  let best = null;
  let bestDist = threshold;
  for (let i = 0; i < screenPoints.length - 1; i++) {
    const a = screenPoints[i];
    const b = screenPoints[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) continue;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < bestDist) {
      bestDist = d;
      best = { segmentIndex: i, t, distance: d };
    }
  }
  return best;
}

// case/contour-geom.js
// Geometria 2D pura do Contorno, em coordenadas de tela (px). Sem DOM, sem
// Three.js — espelha calibre-geom.js: o que dá pra ser puro fica aqui.

// Descarta pontos a menos de `minDist` px do último mantido. O pointermove
// dispara dezenas de vezes por segundo; precisão sub-pixel não muda o recorte,
// só encarece o teste ponto-no-polígono feito por triângulo.
export function appendPoint(points, x, y, minDist = 3) {
  const last = points[points.length - 1];
  if (last && Math.hypot(x - last[0], y - last[1]) < minDist) return false;
  points.push([x, y]);
  return true;
}

// Área pela fórmula do laço (shoelace). Serve pra recusar um "contorno" que
// na prática foi um clique ou um risco reto.
export function polygonArea(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(sum) / 2;
}

export function polygonBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// Devolve um teste (x, y) => boolean para o polígono fechado. Regra par-ímpar
// (ray casting), então um contorno que se cruza vira "buracos" alternados, o
// mesmo que o laço de editores gráficos faz. A caixa envolvente descarta de
// cara a maioria dos triângulos, que ficam longe do contorno.
export function makeInsideTest(points) {
  const n = points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = points[i][0];
    ys[i] = points[i][1];
  }
  const { minX, minY, maxX, maxY } = polygonBounds(points);

  return (x, y) => {
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = ys[i];
      const yj = ys[j];
      if ((yi > y) !== (yj > y) && x < ((xs[j] - xs[i]) * (y - yi)) / (yj - yi) + xs[i]) {
        inside = !inside;
      }
    }
    return inside;
  };
}

// Ponto onde os segmentos p1p2 e p3p4 se cruzam, ou null.
// `inclusive = false`: só cruzamento de verdade — encostar pela ponta não
// conta (segmentos vizinhos sempre compartilham um vértice).
// `inclusive = true`: encostar e sobrepor também contam; é o teste certo
// entre lados NÃO vizinhos de um polígono (um oito que passa duas vezes pelo
// mesmo ponto, um traço que refaz o próprio caminho).
export function segmentIntersection(p1, p2, p3, p4, inclusive = false) {
  const rx = p2[0] - p1[0], ry = p2[1] - p1[1];
  const sx = p4[0] - p3[0], sy = p4[1] - p3[1];
  const qx = p3[0] - p1[0], qy = p3[1] - p1[1];
  const den = rx * sy - ry * sx;
  const eps = 1e-9;
  if (Math.abs(den) < eps) {
    // Paralelos: só se tocam se forem colineares e se sobrepuserem.
    if (!inclusive || Math.abs(qx * ry - qy * rx) > eps) return null;
    const rr = rx * rx + ry * ry;
    if (rr < eps) return null;
    const t0 = (qx * rx + qy * ry) / rr;
    const t1 = t0 + (sx * rx + sy * ry) / rr;
    if (Math.max(t0, t1) < 0 || Math.min(t0, t1) > 1) return null;
    const t = Math.min(Math.max(Math.min(t0, t1), 0), 1);
    return [p1[0] + t * rx, p1[1] + t * ry];
  }
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  const outside = inclusive
    ? (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps)
    : (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps);
  return outside ? null : [p1[0] + t * rx, p1[1] + t * ry];
}

// true se nenhum lado do polígono fechado cruza, encosta ou se sobrepõe a
// outro lado que não seja vizinho dele.
export function isSimplePolygon(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;   // vizinhos pelo fechamento
      if (segmentIntersection(a1, a2, points[j], points[(j + 1) % n], true)) return false;
    }
  }
  return true;
}

// Fecha o traço à mão livre num polígono simples. Quem desenha costuma passar
// do ponto de partida: o fim cruza o começo, ou volta por cima dele. Nos dois
// casos o polígono vira a volta entre os dois pontos. Um contorno que se cruza
// de outro jeito (um oito) não tem "dentro" claro: retorna null.
export function tidyLoop(points, snapPx = 6) {
  const n = points.length;
  const lim = Math.max(3, Math.floor(n * 0.15));   // "perto das pontas"
  let loop = null;
  outer:
  for (let k = n - 2; k >= n - 1 - lim; k--) {
    for (let i = 0; i < Math.min(lim, k - 1); i++) {
      const x = segmentIntersection(points[i], points[i + 1], points[k], points[k + 1]);
      if (x) {
        loop = [x, ...points.slice(i + 1, k + 1)];
        break outer;
      }
      // Voltou por cima do começo sem cruzar (refez o traço, ou parou colado).
      const end = points[k + 1];
      if (k + 1 - i >= 3 && Math.hypot(end[0] - points[i][0], end[1] - points[i][1]) < snapPx) {
        loop = points.slice(i, k + 1);
        break outer;
      }
    }
  }
  loop = loop ?? points.slice();
  // Último ponto em cima do primeiro duplicaria um vértice do polígono.
  const [f, l] = [loop[0], loop[loop.length - 1]];
  if (loop.length > 3 && f[0] === l[0] && f[1] === l[1]) loop.pop();
  return loop.length >= 3 && isSimplePolygon(loop) ? loop : null;
}

// Tira pontos alinhados com os vizinhos (área do triângulo < `minArea` px²).
// O earcut, que triangula as tampas do prisma de corte, descarta pontos
// colineares por conta própria; se ficassem, a tampa não fecharia com as
// laterais e o prisma sairia aberto.
export function dropCollinear(points, minArea = 0.5) {
  const pts = points.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (area2 < minArea * 2) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts;
}

// Atributo `d` de um <path> SVG. `closed` fecha o polígono com Z.
export function pathData(points, closed) {
  if (points.length === 0) return "";
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += `L${points[i][0].toFixed(1)} ${points[i][1].toFixed(1)}`;
  }
  return closed ? d + "Z" : d;
}

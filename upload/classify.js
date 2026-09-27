// upload/classify.js
// O que o clínico soltou na área única → estruturas ou exame. Pelo nome e, no
// .zip, pela lista de arquivos de dentro (sem descompactar). DICOM de PACS
// muitas vezes não tem extensão ("IM000001") ou tem nome de UID
// ("1.2.840…3"): esses vão como candidatos a DICOM e dicom-series.js decide
// pelo conteúdo.

import { readable, readZipIndex } from "./zip-read.js";

const MODEL_EXTS = new Set([".stl", ".obj", ".mtl"]);
const TEXTURE_EXTS = new Set([".jpg", ".jpeg", ".png"]);
// Lixo de sistema operacional.
const JUNK = /^(\.|Thumbs\.db$|desktop\.ini$)/i;
// Pasta de CD/PACS costuma trazer um visualizador embutido. Esses arquivos
// claramente não são imagem DICOM e ficam de fora sem nem ser abertos.
const NON_DICOM_EXTS = new Set([
  ".exe", ".dll", ".msi", ".cab", ".sys", ".ocx", ".bat", ".cmd", ".sh", ".app", ".jar", ".lnk",
  ".html", ".htm", ".js", ".css", ".json", ".xml", ".xsl", ".ini", ".inf", ".cfg", ".log",
  ".txt", ".md", ".rtf", ".pdf", ".doc", ".docx", ".chm", ".hlp",
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".ico", ".svg", ".mp4", ".mov", ".avi",
]);

export const extOf = (name) => (name.match(/\.[^./]+$/)?.[0] || "").toLowerCase();
const baseName = (path) => path.split("/").pop();
const isJunk = (path) => JUNK.test(baseName(path)) || path.startsWith("__MACOSX/");

// Pode ser uma imagem DICOM? (Sem extensão, .dcm/.dicom/.ima, ou "extensão"
// numérica de nome-UID.)
export function maybeDicomName(name) {
  const e = extOf(name);
  return e === "" || e === ".dcm" || e === ".dicom" || e === ".ima" || /^\.\d+$/.test(e);
}

// → { structures: File[], nrrds: File[], dicom: File[],
//     zips: [{ file, entries }]   (.zip de exame que dá para ler aqui),
//     opaqueZips: File[]           (.zip que o navegador não lê: vai inteiro),
//     ignored: número, error: texto | null }
export async function classifyFiles(files) {
  const out = { structures: [], nrrds: [], dicom: [], zips: [], opaqueZips: [], ignored: 0, error: null };
  const named = files.filter((f) => !isJunk(f.webkitRelativePath || f.name));
  out.ignored += files.length - named.length;
  // Textura só é estrutura quando vem com o .obj que a usa.
  const hasObj = named.some((f) => extOf(f.name) === ".obj");

  for (const f of named) {
    const e = extOf(f.name);
    if (MODEL_EXTS.has(e)) {
      out.structures.push(f);
    } else if (TEXTURE_EXTS.has(e)) {
      if (hasObj) out.structures.push(f);
      else out.ignored++;
    } else if (e === ".nrrd") {
      out.nrrds.push(f);
    } else if (e === ".nhdr") {
      out.error = "Este NRRD tem os dados num arquivo separado (.nhdr + .raw). Exporte como um único arquivo .nrrd.";
      return out;
    } else if (e === ".zip") {
      let entries;
      try {
        entries = (await readZipIndex(f)).filter((x) => !isJunk(x.name));
      } catch (_) {
        out.opaqueZips.push(f);
        continue;
      }
      const names = entries.map((x) => x.name);
      const model = names.some((n) => MODEL_EXTS.has(extOf(n)));
      const obj = names.some((n) => extOf(n) === ".obj");
      const nrrdInside = names.some((n) => extOf(n) === ".nrrd");
      const dicomInside = names.some((n) => maybeDicomName(n));
      if (model && (nrrdInside || dicomInside)) {
        out.error = `O arquivo ${f.name} tem estruturas e exame juntos. Envie as estruturas e o exame em arquivos separados.`;
        return out;
      }
      if (obj) out.structures.push(f);
      else if (model) {
        out.error = `O arquivo ${f.name} tem arquivos .stl compactados. Descompacte e envie os .stl soltos.`;
        return out;
      } else if (nrrdInside) {
        out.opaqueZips.push(f); // NRRD dentro do .zip: o servidor abre
      } else if (dicomInside) {
        // Só as entradas que podem ser imagem (o visualizador do CD e afins
        // nem são abertos). Se o navegador não consegue ler alguma delas
        // (compressão que não é deflate, senha, sem DecompressionStream), o
        // .zip vai inteiro e o servidor decide.
        const images = entries.filter((x) => maybeDicomName(x.name) && !NON_DICOM_EXTS.has(extOf(x.name)));
        const canInflate = typeof DecompressionStream !== "undefined";
        const browserReads = images.every((x) => readable(x) && (x.method === 0 || canInflate));
        if (browserReads) {
          out.zips.push({ file: f, entries: images });
          out.ignored += entries.length - images.length;
        } else {
          out.opaqueZips.push(f);
        }
      } else {
        out.ignored++;
      }
    } else if (NON_DICOM_EXTS.has(e)) {
      out.ignored++;
    } else if (maybeDicomName(f.name)) {
      out.dicom.push(f);
    } else {
      out.ignored++;
    }
  }
  return out;
}

export const hasExam = (c) => !!(c.nrrds.length || c.dicom.length || c.zips.length || c.opaqueZips.length);

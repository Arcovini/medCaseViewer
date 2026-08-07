# Interações booleanas entre estruturas — configuração no upload

**Data:** 2026-08-07 · **Repos:** medCaseViewer (`/upload/`) + mesh-processor

## Problema

O clínico precisa destacar a região de contato entre duas estruturas (ex.: a
porção de um tumor que invade o rim). Hoje o viewer só mostra as malhas como
foram segmentadas; não há como derivar "o que está dentro / fora" de outra
estrutura.

## Semântica (fixa, definida pelo produto)

Uma interação booleana é um par ordenado **(A principal, B secundária)**:

| Estrutura | Resultado |
|---|---|
| A (principal) | **Intacta** — nenhuma mudança |
| B (secundária) | Substituída por **B − A** (subtração) |
| Nova malha | **B ∩ A** (interseção), inserida logo após B na lista |

Casos-limite:
- **B ∩ A vazia** (estruturas não se tocam) → erro 400 claro em pt-BR; a
  configuração está errada e o clínico deve corrigi-la antes de processar.
- **B − A vazia** (B inteiramente dentro de A) → B é removida; só a interseção
  (igual à B original) permanece. Geometricamente correto.
- **Malha não estanque** (open edges) → erro 400 em pt-BR antes de tentar a
  booleana.
- Várias interações são aplicadas **em sequência, na ordem configurada**; uma B
  já recortada pode ser recortada de novo por outra principal.

## Onde a booleana roda

No backend (**mesh-processor**), dentro de `processor.py`, usando
`trimesh.boolean` com engine **manifold3d** (novo dep, wheels para linux/amd64
e arm64). Roda **após a decimação** (malhas menores → booleana mais rápida,
resultado já lean) e **antes** da rotação RAS→glTF e da coloração.

A tela de upload só **captura e envia** a configuração — se no futuro a
booleana migrar para um worker/browser, o contrato não muda.

## Contrato frontend → backend

`POST /upload` ganha um form field opcional:

```
boolean_ops = '[{"principal": "<filename.stl>", "secondary": "<filename.stl>"}]'
```

- Nomes = filenames originais enviados no mesmo request (o backend mapeia para
  os nomes limpos por índice em `file_pairs`).
- Válido apenas no caminho STL-only (400 caso contrário).
- Validações (400, pt-BR): JSON malformado, filename desconhecido,
  `principal == secondary`, par duplicado, mais de 20 interações.
- Backends antigos ignoram o campo (FastAPI descarta form fields extras) —
  frontend pode ser deployado antes do backend sem quebrar.

## Nomes e cores da interseção

- Nome do nó: `Intersecao <B> x <A>` (ASCII — acentos viram mojibake no glTF).
- Nova keyword de cor `"intersec"` → amarelo vivo `#FFE100`, inserida **no
  topo** de `COLORS_BY_KEYWORD` (a keyword precisa vencer `tumor`/`rim`/etc.
  contidos no nome composto).
- B − A mantém o nome de B → mantém a cor/keyword de B. O viewer não muda:
  os toggles por estrutura derivam dos nomes de nós do GLB.

## UI (`/upload/index.html` + `upload.js`)

Seção **"Interações booleanas (opcional)"** entre a lista de arquivos e o botão
Processar, visível apenas quando ≥2 STLs estão selecionados (some no fluxo OBJ).

- Lista de cartões, um por interação: select **Principal (mantida intacta)** +
  select **Secundária (será recortada)** + botão remover.
- O select da secundária omite o arquivo escolhido como principal (impossível
  escolher A = B).
- Prévia do resultado em chips coloridos dentro do cartão:
  `A · intacta` / `B − A · recorte` / `B ∩ A · interseção` (amarelo).
- Par duplicado → cartão marcado em vermelho + Processar desabilitado.
- "+ Adicionar interação" cria um cartão com o primeiro par ainda não usado;
  desabilita quando todos os pares foram usados.
- Trocar a seleção de arquivos reconcilia: interações órfãs são descartadas.
- Mensagem "Calculando interações booleanas..." entra no rotator de status
  quando há interações configuradas.

## Fora de escopo

- Booleana no fluxo OBJ (materiais/UVs complicam; STL cobre o caso clínico).
- Escolher o tipo de operação (união, só subtração etc.) — a semântica
  A-intacta/B−A/B∩A é fixa por decisão de produto.
- Mudanças no viewer.

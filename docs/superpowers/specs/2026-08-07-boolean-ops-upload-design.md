# Dividir uma estrutura pela outra (dentro/fora) — configuração no upload

**Data:** 2026-08-07 · **Repos:** medCaseViewer (`/upload/`) + mesh-processor

## Problema

O clínico precisa destacar a região de contato entre duas estruturas (ex.: a
porção de um tumor que invade o rim). Hoje o viewer só mostra as malhas como
foram segmentadas; não há como derivar "o que está dentro / fora" de outra
estrutura.

## Nomenclatura (revisada em 2026-08-07)

A primeira versão chamava isto de **"interações booleanas"**, com campos
"principal / secundária" e resultado "interseção / recorte". Vocabulário de
geometria computacional: o radiologista não pensa em operações de conjunto,
pensa em anatomia. Renomeado para o que a operação **significa clinicamente**:

| Antes (jargão) | Agora (clínico) |
|---|---|
| Interações booleanas | Dividir uma estrutura pela outra |
| Principal (mantida intacta) | Referência (fica inteira) |
| Secundária (será recortada) | A dividir (dentro e fora) |
| `B − A` / recorte | `B fora de A` |
| `Intersecao B x A` / interseção | `B dentro de A` |

Os nomes das peças resultantes são as **próprias frases** que aparecem na lista
de estruturas do viewer ("Tumor dentro de Rim"), então o rótulo na tela de
upload e o rótulo no viewer são o mesmo texto: nada para traduzir mentalmente.
O nome do form field (`boolean_ops`) e os identificadores internos ficam como
estão: contrato de API, não texto de interface.

## Semântica (fixa, definida pelo produto)

Um par ordenado **(referência A, estrutura a dividir B)**:

| Estrutura | Resultado |
|---|---|
| A (referência) | **Fica inteira** — nenhuma mudança |
| B (a dividir) | Renomeada para **`B fora de A`**, com a geometria B−A |
| Nova malha | **`B dentro de A`** (B ∩ A), inserida logo após B, em amarelo |

Casos-limite:
- **Sem sobreposição** (estruturas não se tocam) → erro 400 em pt-BR; a
  configuração está errada e o clínico deve corrigi-la antes de processar.
- **B inteiramente dentro de A** → a peça "fora" é vazia; B some e só
  `B dentro de A` permanece. Geometricamente correto.
- **Malha não estanque** (open edges) → erro 400 em pt-BR antes de operar.
- Várias divisões são aplicadas **em sequência, na ordem configurada**; uma peça
  já dividida pode ser dividida de novo por outra referência, e os nomes
  compõem (`Tumor fora de Rim dentro de Coluna`). O índice interno é chaveado
  pelos nomes **originais** (os que o clínico configurou), então o encadeamento
  não depende dos renames.

## Onde a operação roda

No backend (**mesh-processor**), em `processor.py`, usando `trimesh.boolean`
com engine **manifold3d** (novo dep, wheels para linux/amd64 e arm64). Roda
**após a decimação** (malhas menores → operação mais rápida, resultado já lean)
e **antes** da rotação RAS→glTF e da coloração.

**Limpeza obrigatória do resultado** (`_clean_boolean_result`): o manifold3d
devolve algumas faces de área zero; com elas o trimesh conta arestas
compartilhadas por mais de duas faces e classifica o resultado como NÃO
estanque (`euler_number` 6 em vez de 2). Sem `process(validate=True)` as
divisões encadeadas falham na checagem de malha fechada, e as peças ficariam
"abertas" para o modo volume do viewer. A limpeza não altera o volume.

A tela de upload só **captura e envia** a configuração — se no futuro a operação
migrar para um worker/browser, o contrato não muda.

## Contrato frontend → backend

`POST /upload` ganha um form field opcional:

```
boolean_ops = '[{"principal": "<filename.stl>", "secondary": "<filename.stl>"}]'
```

- `principal` = referência, `secondary` = estrutura a dividir (nomes de campo
  preservados como contrato; a UI usa o vocabulário clínico).
- Nomes = filenames originais enviados no mesmo request (o backend mapeia para
  os nomes limpos por índice em `file_pairs`).
- Válido apenas no caminho STL-only (400 caso contrário).
- Validações (400, pt-BR): JSON malformado, filename desconhecido,
  referência igual à estrutura a dividir, par repetido, mais de 20 divisões.
- Backends antigos ignoram o campo (FastAPI descarta form fields extras) —
  frontend pode ser deployado antes do backend sem quebrar.

## Cores

- Nova keyword `"dentro de"` → amarelo vivo `#FFE100`, inserida **no topo** de
  `COLORS_BY_KEYWORD`: o nome composto contém os nomes das duas estruturas de
  origem, e o destaque precisa vencer as keywords contidas neles (`tumor`,
  `rim`, ...).
- `"fora de"` **não** é keyword: a peça externa mantém a cor da estrutura de
  origem de propósito (continua sendo o tumor, só menor).
- Duas peças "dentro de" no mesmo caso caem no mesmo bucket e variam HSV
  (`#FFE100`, depois `#DEC821`), como qualquer cor duplicada.
- O acabamento metálico é vetado apenas na peça interna (`Stent metal dentro de
  Arteria` lê como destaque); a peça externa continua metálica.

## UI (`/upload/index.html` + `upload.js`)

Seção **"Dividir uma estrutura pela outra (opcional)"** entre a lista de
arquivos e o botão Processar, visível apenas quando ≥2 STLs estão selecionados
(some no fluxo OBJ).

- Um cartão por divisão: select **Referência · fica inteira** + select
  **A dividir · dentro e fora** + botão remover.
- O select "a dividir" omite o arquivo escolhido como referência (impossível
  dividir uma estrutura por ela mesma).
- Prévia em chips com os **nomes finais** das peças: `A · fica inteira` /
  `B fora de A` / `B dentro de A · destaque` (amarelo).
- Par repetido → cartão em vermelho + Processar desabilitado + aviso.
- "+ Adicionar divisão" cria um cartão com o primeiro par ainda não usado;
  desabilita quando todos os pares foram usados.
- Trocar a seleção de arquivos reconcilia: divisões órfãs são descartadas.
- "Dividindo estruturas em dentro e fora..." entra no rotator de status quando
  há divisões configuradas.
- Selects com anel de foco visível (`focus:ring-2`), já que `outline-none` é
  usado para trocar o anel do navegador.

## Fora de escopo

- Divisão no fluxo OBJ (materiais/UVs complicam; STL cobre o caso clínico).
- Escolher o tipo de operação (união, só subtração etc.): a semântica
  fica-inteira / fora / dentro é fixa por decisão de produto.
- Mudanças no viewer (os toggles derivam dos nomes de nós do GLB).

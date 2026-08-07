# Product

> Sintetizado do CLAUDE.md e do código em 2026-08-07 (sessão autônoma, sem
> entrevista). Itens marcados *(inferido)* merecem revisão do time.

## Register

product

## Users

Médicos radiologistas e cirurgiões da rede Dasa (Brasil) planejando cirurgias.
Dois contextos: o **clínico que envia um caso** (`/upload/`, tarefa rápida entre
laudos, sem paciência para jargão técnico) e o **cirurgião/radiologista que
explora o modelo 3D** (`/case/`, precisa de medidas confiáveis em mm/cm³ e de
controle por estrutura anatômica). Idioma: português brasileiro. Toda a UI fala
a língua clínica deles, nunca a nossa (nomes de estruturas, "dentro/fora",
nunca termos de computação gráfica como "booleana" ou "mesh").

## Product Purpose

Transformar segmentações de exames (STL/OBJ) em um modelo 3D interativo com
link compartilhável, para planejamento cirúrgico: visualizar relações entre
estruturas, medir (distância, volume, calibre de vasos) e discutir o caso.
Sucesso: o clínico envia arquivos e obtém um link funcional em minutos, sem
suporte.

## Brand Personality

Clínico, direto, confiável *(inferido)*. A interface desaparece atrás da
tarefa; a "personalidade" é a competência: mensagens de erro que dizem o que
fazer, medidas com unidade correta, nomes anatômicos limpos.

## Anti-references

- Dashboards SaaS genéricos (hero metrics, gradientes) — isto é uma ferramenta
  clínica, não um produto de growth. *(inferido)*
- Jargão de engenharia 3D na UI (booleana, mesh, decimação, watertight). O
  radiologista pensa em anatomia, não em geometria computacional.
- Qualquer estética que sugira "brinquedo": o dado é cirúrgico.

## Design Principles

1. **Língua clínica, sempre**: cada rótulo deve ser compreensível por um
   radiologista sem explicação; se precisa de tooltip para traduzir um termo
   técnico, o termo está errado.
2. **O modelo é o palco**: cromo mínimo (cinza/azul contido), cor saturada
   reservada às estruturas anatômicas e aos destaques clínicos.
3. **Erros orientam a correção**: toda falha diz o que aconteceu e o que fazer,
   em pt-BR, no vocabulário do clínico.
4. **Fluxos de uma sentada**: upload e configuração cabem numa tela, sem
   wizard; o clínico não volta amanhã para terminar.

## Accessibility & Inclusion

Sem requisito formal declarado *(inferido)*. Piso prático: contraste AA em
texto, alvos de toque adequados (uso frequente em tablet), `prefers-reduced-motion`
respeitado no viewer.

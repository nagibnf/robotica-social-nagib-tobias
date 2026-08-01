# Robótica Social — Nagib × Tobias

Apresentação interativa em oito atos sobre corpo, presença e relações entre
humanos e máquinas. O deck usa Reveal.js para navegação e Three.js para o campo
espacial em tempo real.

## Navegação

- clique ou seta para a direita: próximo ato
- clique no extremo esquerdo ou seta para a esquerda: ato anterior
- `C`: tela de contingência
- `F`: tela cheia

## Desenvolvimento

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run dev
```

## Publicação

O workflow `Deploy GitHub Pages` gera uma exportação estática e publica
automaticamente cada atualização enviada para a branch `main`.

```bash
npm run build:pages
```

O build estático é escrito em `out/`.

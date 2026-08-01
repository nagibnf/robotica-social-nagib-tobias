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

## Docker (máquina de apresentação)

Deck em produção com proxy PRS para SSE ao vivo. Ajuste o host do PRS via
variável de ambiente.

```bash
cp .env.example .env
# edite PRS_HOST se o backend PRS mudar de IP/host

docker compose up --build
```

Abra `http://<ip-da-máquina>:3000`. O browser usa a porta **3010** no mesmo
host para streams SSE (evita buffer do Next). Garanta que a máquina alcança
`PRS_HOST` (ex.: Tailscale).

Sem Compose, só imagem:

```bash
docker build -t robotica-social-deck .
docker run --rm -p 3000:3000 -p 3010:3010 \
  -e PRS_HOST=http://100.91.252.69:8080 \
  robotica-social-deck
```

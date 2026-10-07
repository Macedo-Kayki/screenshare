# ScreenShare

Compartilhamento de tela em tempo real com WebRTC (P2P) e sinalização via Socket.IO.

## Rodando

```bash
npm install
npm start        # ou: npm run dev (reinicia ao salvar)
```

Acesse http://localhost:3000.

> O `getDisplayMedia` só funciona em **HTTPS** (ou `localhost`). Em produção, coloque o servidor atrás de um proxy com TLS (Nginx, Caddy, Cloudflare etc.).

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `MAX_VIEWERS` | `10` | Máximo de espectadores por sala. A topologia é mesh: o broadcaster envia o vídeo para cada espectador, então o upload necessário cresce com o número de pessoas |
| `TURN_URLS` | — | URLs do servidor TURN separadas por vírgula, ex.: `turn:turn.exemplo.com:3478,turns:turn.exemplo.com:5349` |
| `TURN_SECRET` | — | Segredo compartilhado do coturn (`use-auth-secret`). Gera credenciais temporárias (recomendado) |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | — | Credenciais fixas, usadas se `TURN_SECRET` não estiver definido |

Sem TURN, conexões atrás de NAT simétrico, 4G ou redes corporativas podem falhar.

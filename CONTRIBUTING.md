# Guia de Contribuição — Escritório Virtual

Agradecemos o interesse em contribuir com o **Escritório Virtual**! Este documento orienta sobre o fluxo de desenvolvimento, padrões de código e submissão de Pull Requests.

## 1. Primeiros Passos

1. Faça um fork do repositório e clone-o localmente.
2. Certifique-se de estar utilizando o **Node.js 24+**.
3. Instale as dependências:
   ```bash
   npm ci --ignore-scripts
   ```

## 2. Estrutura do Repositório

O projeto é organizado como um monorepo com as seguintes pastas:

- `client/`: Aplicação frontend SPA (Vite + PixiJS v8).
- `server/`: Backend autoritativo WebSocket e API REST (Express 5 + Colyseus 0.18 + SQLite).
- `shared/`: Tipos compartilhados, contratos Zod, matemática de projeção isométrica e pathfinding A*.
- `extensions/`: Plugins de telemetria para IDEs (`extensions/vscode` e `extensions/visual-studio`).
- `deploy/`: Manifestos de infraestrutura (Docker, Caddy, Fly.io).
- `docs/`: Caderno de especificações (`SPEC.md`), histórico de fases (`PLAN.md`) e documentação de assets (`ASSETS.md`).

## 3. Scripts Disponíveis

- `npm run dev`: Inicia servidor e cliente em modo desenvolvimento.
- `npm run build`: Compila o cliente para produção.
- `npm test`: Executa a suíte de testes unitários e de integração com Vitest.
- `npm run typecheck`: Executa a validação estática de tipos do TypeScript.
- `npm run lint`: Valida as regras de linting com ESLint.
- `npm run format`: Formata todos os arquivos com Prettier.

## 4. Padrões de Commit

Recomendamos o padrão **Conventional Commits**:

- `feat:` Nova funcionalidade
- `fix:` Correção de bug
- `refactor:` Alteração de código sem impacto comportamental externo
- `docs:` Alterações na documentação
- `test:` Adição ou correção de testes
- `chore:` Tarefas de manutenção ou dependências

## 5. Submissão de Pull Requests

Antes de submeter o seu Pull Request:

1. Garanta que todos os testes passem: `npm test`
2. Garanta que a checagem de tipos passe: `npm run typecheck`
3. Preencha o template de Pull Request fornecendo contexto sobre a alteração.

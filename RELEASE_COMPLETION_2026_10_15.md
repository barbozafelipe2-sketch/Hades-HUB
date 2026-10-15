# Kairos — conclusão do lote de melhorias

## Implementado

- **Compras simuladas:** Apply to Wallet agora prepara uma revisão no servidor. A tela mostra orçamento, depósito simulado necessário, ativos, quantidades, preços e caixa resultante. A execução exige confirmação de um plano do próprio usuário, válido por dois minutos. Mudanças de carteira ou preço exigem nova revisão. Reenvios e recuperação de respostas perdidas não duplicam lançamentos; o comportamento é testado também com JSONB/Postgres.
- **Restauração:** os artefatos são gravados e conferidos em uma nova geração antes da troca da referência ativa. A geração anterior permanece disponível. A coordenação por tenant e a recuperação de restauração interrompida continuam protegendo a parte relacional. Exclusão de workspace limpa também gerações antigas e parcialmente preparadas, em lotes limitados.
- **Interface:** acessibilidade, gráficos e revisão de compras saíram do arquivo principal para módulos próprios. O navegador recebe um único app.css gerado a partir das fontes existentes, preservando a ordem visual. Tokens e estilos da revisão ficam separados. A consolidação de todos os componentes antigos e remoção dos !important ainda não são uma reescrita concluída.
- **Verificação:** testes Playwright percorrem as sete telas em 1440, 390 e 320 px; verificam revisão/cancelamento/confirmação/reenvio, rótulos e regras WCAG A com axe, navegação por teclado, retorno de foco e ausência de erros JS/overflow nos cenários exercitados. Não se afirma certificação completa WCAG AA.
- **Publicação verificável:** npm run build executa a verificação e gera release.json com o commit e as migrações exigidas. Isso identifica o código entregue, sem afirmar que as migrações foram executadas. O diagnóstico de lançamento, restrito ao owner, verifica as chaves compostas efetivamente presentes no banco por uma consulta somente de leitura.

## Evidências externas em 15/10/2026

- CI do commit 6656d713d38a5c55a81305604fbd227ac80421aa: **success**, [execução 38698521986](https://github.com/barbozafelipe2-sketch/Hades-HUB/actions/runs/38698521986).
- Projeto Netlify: [hades-os](https://app.netlify.com/projects/hades-os), cb8da6dc-9f3d-4751-abcf-1e08c667805c.
- A consulta ao projeto continua indicando o deploy publicado 6ab182518634bd59892f43a0. A consulta anterior de detalhes o identificou como drop/API, sem commit_ref e sem metadados de migrações. Isso não comprova entrega da main atual.
- As requisições públicas por HTTPS retornaram **HTTP 503**, com corpo `{"error":"usage_exceeded","message":"Usage exceeded",...}`. Esse limite da conta precisa ser regularizado antes do smoke test online.
- A listagem de variáveis do projeto consultada contém sete nomes de variáveis legadas/provedores. Nela não apareceram as configurações Stripe nem a configuração/licença do feed primário exigidas pelo código comercial. Valores de credenciais não foram registrados ou alterados. Variáveis herdadas não comprovadas e configurações gerenciadas de Identity precisam ser verificadas no ambiente isolado.
- A autenticação implementada continua sendo Netlify Identity. Não houve migração para outro provedor.

## Validação reproduzível

1. Usar Node 24 e executar `npm ci --ignore-scripts`.
2. Usar um Postgres 16 **descartável e isolado**, definir KAIROS_TEST_DATABASE_URL para ele e executar `npm run build`. Os testes de banco modificam suas tabelas; nunca apontar essa variável para produção.
3. Instalar Chromium com `npx playwright install --with-deps chromium` e executar `npm run test:browser`. Para Chromium já instalado localmente, PLAYWRIGHT_CHROMIUM_EXECUTABLE pode indicar o executável.
4. Depois de conectar/publicar o commit correto, executar `NODE_USE_ENV_PROXY=1 node scripts/site-smoke.mjs https://hades-os.netlify.app COMMIT_SHA` quando houver proxy. Em acesso direto, omitir NODE_USE_ENV_PROXY. O teste é somente de leitura e não certifica os fluxos autenticados.
5. Conferir launch-readiness com uma sessão owner em preview isolado e executar o roteiro comercial abaixo.

## Dependências externas restantes

Regularizar o limite de uso Netlify; confirmar conexão Git/main e ambiente de preview isolado; confirmar/aplicar migrações pelo workflow de deploy; configurar as integrações nesse preview; validar confirmação de e-mail, login/recuperação/permissões e Stripe em modo de teste (checkout, assinatura, webhooks, cancelamento e expiração).

Não foram feitas compras reais, alteração de credenciais, migração direta em produção, abertura de cadastro público ou promoção manual de deploy. Não há credenciais de sandbox comercial configuradas no executor para concluir esses fluxos remotos. A presença dos novos testes locais não substitui essa validação.

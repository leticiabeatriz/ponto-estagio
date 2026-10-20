# Ponto

Controle pessoal de jornada e banco de horas. Reescrita do programa do ZIP original, com interface responsiva, Supabase Auth e armazenamento por conta.

## Rodar

Requer Node.js 22+ para testes e Python 3 para o servidor local. O aplicativo é HTML, CSS e módulos JavaScript; não precisa de build nem de instalação de pacotes para funcionar.

```sh
npm test
npm start
```

Abra `http://localhost:4173`. Use **Explorar demonstração** para conhecer a interface sem autenticar nem gravar no banco. Os registros da demonstração ficam apenas na memória da página e são descartados ao sair. PIN da demonstração: `1234`.

O SDK oficial do Supabase é carregado por URL com versão fixa `2.118.0`. Login e banco exigem internet; as fontes têm fallback local.

## Banco e acesso

O arquivo `js/config.js` aponta para o projeto existente **Meu celeiro**. O Ponto usa as mesmas contas de e-mail e senha, com sessão própria no navegador (`ponto-pp-auth`). As tabelas `ponto_profiles` e `ponto_entries` são exclusivas do Ponto; as tabelas e o PIN do Meu Celeiro não são alterados. O PIN do Ponto é escolhido no primeiro acesso.

**Configuração remota ainda não confirmada:** as consultas ao Supabase expiraram no ambiente de desenvolvimento. O esquema está preparado em `supabase/schema.sql`, mas sua aplicação e o fluxo real de login/gravação precisam ser confirmados antes de considerar o aplicativo pronto para uso em produção.

Para configurar:

1. No SQL Editor do projeto Supabase correto, verifique se `ponto_profiles` e `ponto_entries` já existem. Execute `supabase/schema.sql` uma única vez se ainda não existirem. A transação cria tabelas, índices, restrições e políticas RLS.
2. Para usar outro projeto, altere a URL e a chave **publicável** em `js/config.js` e crie uma conta em **Authentication → Users**. Nunca coloque uma chave secreta ou `service_role` no código do navegador.
3. Adicione a URL publicada do Ponto em **Authentication → URL Configuration → Redirect URLs**, para permitir a recuperação de senha. Preserve as URLs existentes do Meu Celeiro.
4. Entre com e-mail e senha, escolha um PIN de quatro dígitos e faça um registro para conferir o salvamento.

O PIN usa PBKDF2/SHA-256 com salt aleatório e 210.000 iterações, conforme o padrão do Meu Celeiro. Ele bloqueia a interface, não substitui a autenticação do banco. As políticas RLS restringem cada usuário aos próprios registros. Depois de 10 minutos sem interação, a interface bloqueia novamente. A recuperação de senha altera a conta compartilhada com o Meu Celeiro; o formulário informa isso. Para redefinir o PIN, entre novamente com a senha e escolha **Redefinir meu PIN**.

## Regras preservadas

- A jornada prevista é de **5 horas por dia útil com ao menos um registro**.
- Vários intervalos no mesmo dia geram uma única jornada prevista.
- Dias sem registro não geram débito. Sábados e domingos somam como horas extras.
- O saldo acumulado sempre considera todo o histórico. As outras métricas seguem o filtro selecionado.
- Cada intervalo precisa terminar depois de começar, no mesmo dia. Turnos que atravessam a meia-noite devem ser divididos em dois registros.
- O aplicativo rejeita horários sobrepostos e o banco aplica a mesma restrição para gravações concorrentes.

## Seus registros antigos

Clique em **Importar**, escolha o `db.json` da pasta do programa antigo e confirme. A importação preserva os registros atuais, ignora intervalos idênticos e rejeita todo o lote se houver dados inválidos ou sobrepostos. Limite: 5 MB e 10.000 registros por arquivo. O `db.json` original não é enviado para o GitHub; mantenha seu backup.

**Exportar → Backup completo** gera JSON compatível com a importação. **Planilha do período** gera CSV UTF-8 com separador `;`, com proteção contra fórmulas em observações.

## Organização do código

- `js/domain.js`: cálculo de jornadas, semanas, validação e importação.
- `js/database.js`: sessão e persistência com o SDK oficial do Supabase.
- `js/pin.js`: criação e validação de PIN.
- `js/app.js`: interface e tratamento das operações.
- `css/style.css`: estilos, responsividade e impressão.
- `supabase/schema.sql`: esquema isolado do aplicativo, RLS e proteção contra sobreposição.

O salvamento é imediato. Falhas mantêm o formulário aberto e não alteram o estado exibido. Edições e exclusões comparam `updated_at` para detectar alterações feitas por outro dispositivo. Use **Atualizar** para buscar os registros mais recentes; não há sincronização em tempo real nem gravação offline.

## Validação

`npm test` cobre oito cenários: jornada com vários intervalos, dias sem registro e fins de semana, semanas na virada do ano, datas e horários inválidos, sobreposição, importação com duplicados, formatação e PIN.

Há também um roteiro Playwright em `tests/browser.mjs`, com SDK simulado para conferir os formulários e a interação da interface. Não substitui um teste do Supabase real. Para executá-lo em um ambiente com navegador permitido:

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
npm run test:browser
```

Se já houver Chromium instalado, defina `CHROMIUM_PATH` com o caminho do executável. No ambiente de desenvolvimento desta entrega, o navegador foi bloqueado pelo sandbox; o roteiro ainda não foi executado com sucesso. As capturas serão criadas em `test-results/` quando o teste for executado.

## GitHub

O código está em [leticiabeatriz/ponto-estagio](https://github.com/leticiabeatriz/ponto-estagio), com configuração de CI para executar os testes em pushes e pull requests. Não inclua arquivos `.env`, dados pessoais ou o `db.json` antigo.

Para hospedar no GitHub Pages, use a pasta raiz da branch `main` em **Settings → Pages → Deploy from a branch**. Não há build. Uma política de branch pode exigir publicação por Actions; nesse caso configure o workflow de Pages no próprio repositório. Depois, adicione a URL final à lista de redirecionamentos do Supabase.

## Pendências desta entrega

- Confirmar/aplicar o esquema e validar login, RLS e persistência no Supabase real: as consultas expiraram.
- Executar o roteiro no navegador em ambiente autorizado.

As alterações locais e os testes de domínio/PIN estão concluídos. Essas pendências não devem ser tratadas como publicação ou integração remota já verificadas.

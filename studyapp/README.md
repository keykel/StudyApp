# StudyVerse

Plataforma de estudos com XP, conquistas e metas. Frontend em HTML/CSS/JS (sem build), backend no Supabase, hospedagem na Vercel.

## O que está pronto
Todas as páginas: Início, Calendário (mês/semana/dia), Matérias, Conteúdos, Exercícios, Sessões (cronômetro e Pomodoro), Metas, Conquistas (XP, níveis, missões, sequência e linha do tempo), Estatísticas, Revisões (repetição espaçada) e Perfil (tema, cor, notificações, exclusão de conta). Tudo grava no Supabase com RLS.

**Se você já rodou o schema.sql da etapa 1**, rode também `supabase/patch_etapa2.sql` (protege o XP contra edição direta).

## 1. Configurar o Supabase
1. Crie uma conta em supabase.com e um projeto novo (plano gratuito).
2. Abra **SQL Editor > New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Authentication > URL Configuration**, defina *Site URL* com o endereço do site (ex.: `https://seu-site.vercel.app`) e adicione `http://localhost:3000` em *Redirect URLs* para testes.
4. Em **Project Settings > API**, copie a **Project URL** e a chave **anon public**.
5. Cole os dois valores em `js/config.js`. Nunca use a chave `service_role` no código.

## 2. Testar no computador
Na pasta do projeto: `npx serve -l 3000` (ou qualquer servidor estático) e abra `http://localhost:3000`.

## 3. Publicar
1. Crie um repositório no GitHub e envie os arquivos (`git init`, `git add .`, `git commit`, `git push`).
2. Na Vercel: **Add New > Project**, importe o repositório e clique em **Deploy** (sem configurar build).
3. Atualizações: faça `git push`; a Vercel publica sozinha.

## 4. Administrar pelo painel do Supabase
- **Table Editor**: ver e editar registros. **Authentication > Users**: gerenciar contas.
- **Authentication > Policies**: revisar as regras de RLS. **SQL Editor**: alterações no banco.
- O XP só muda pela função `award_xp` (evita fraude e duplicidade). Excluir conta usa `delete_my_account`.

## Testes antes de publicar
Cadastro, login em dois navegadores com a mesma conta (sincronização), segunda conta sem acesso aos dados da primeira, troca de tema, exclusão de conta.

-- Rode UMA vez no SQL Editor (corrige a proteção do XP no schema da etapa 1).
-- O "revoke update (xp)" anterior não tem efeito quando o papel tem UPDATE na tabela inteira.
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, accent, theme, notif_prefs, available_hours) on public.profiles to authenticated;

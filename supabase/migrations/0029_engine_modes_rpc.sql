-- Reading two operational flags should not require a key that bypasses RLS.
--
-- The brand's request page needs to know which engines would actually reach a
-- paid API right now, so it can say "replay" before the brand picks one rather
-- than after the render turns out not to be live. It was reading
-- platform_settings with the SERVICE-ROLE client — a key that bypasses every
-- policy in the database — to learn that. The repository's own lint rule
-- forbids exactly this import outside the API and script directories, and it
-- was right to: the blast radius of that key is the entire database, and the
-- page wanted two rows.
--
-- This exposes only the engine_mode_* keys, and nothing else in
-- platform_settings (take_rate_bps is already public by another route;
-- credit_packs and payments_live are not this page's business). Writing the
-- values stays admin-only through update_platform_setting, untouched.

create or replace function public.get_engine_modes()
returns table (engine text, mode text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select replace(key, 'engine_mode_', '') as engine,
         value #>> '{}'                   as mode
    from platform_settings
   where key like 'engine\_mode\_%'
$function$;

comment on function public.get_engine_modes() is
  'Per-engine live/replay/auto switches, and nothing else from platform_settings. '
  'Read-only and definer so a signed-in page can ask without a service-role key.';

revoke execute on function public.get_engine_modes() from public;
grant  execute on function public.get_engine_modes() to anon, authenticated, service_role;

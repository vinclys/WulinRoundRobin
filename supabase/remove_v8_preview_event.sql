-- Remove only the isolated v8 Preview event. History is deleted by cascade.
delete from public.tournaments
where slug = 'wulin-annual-2026-v8-preview';

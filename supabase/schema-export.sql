select json_build_object(
  'tables', (select json_agg(json_build_object('table', table_name, 'column', column_name, 'type', data_type, 'default', column_default, 'nullable', is_nullable) order by table_name, ordinal_position)
             from information_schema.columns where table_schema = 'public'),
  'policies', (select json_agg(json_build_object('schema', schemaname, 'table', tablename, 'name', policyname, 'cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check))
               from pg_policies where schemaname in ('public', 'storage')),
  'functions', (select json_agg(json_build_object('name', p.proname, 'def', pg_get_functiondef(p.oid)))
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
  'triggers', (select json_agg(json_build_object('table', event_object_table, 'name', trigger_name, 'action', action_statement))
               from information_schema.triggers where trigger_schema = 'public'),
  'buckets', (select json_agg(json_build_object('id', id, 'public', public, 'limit', file_size_limit)) from storage.buckets),
  'realtime', (select json_agg(tablename) from pg_publication_tables where pubname = 'supabase_realtime')
) as schema;

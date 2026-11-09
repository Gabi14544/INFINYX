\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end $$;
insert into auth.users values('11111111-1111-4111-8111-111111111111','alice@test.invalid'),('22222222-2222-4222-8222-222222222222','bob@test.invalid');
select pg_temp.assert_true((select count(*)=2 from public.profiles),'signup trigger provisions profiles');
select pg_temp.assert_true((select count(distinct vault_salt)=2 from public.profiles),'random independent salts');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.vault_credentials','select'),'verifiers are private');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.documents','delete'),'no direct deletion');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.profiles','update'),'no salt modification');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.finish_vault_delete(uuid,uuid)','execute'),'no delete RPC bypass');
select pg_temp.assert_true(not has_function_privilege('anon','public.commit_vault_version(uuid,integer,text,text,text)','execute'),'no anonymous uploads');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select pg_temp.assert_true((select count(*)=1 from public.profiles),'RLS hides other profiles');
insert into storage.objects(bucket_id,name,owner_id) values('vault_files','11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.enc','11111111-1111-4111-8111-111111111111');
select pg_temp.assert_true((select count(*)=0 from storage.objects),'direct storage reads blocked despite broad old policy');
select public.commit_vault_version('33333333-3333-4333-8333-333333333333',1,'11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.enc',repeat('ab',12),'v2:'||repeat('ab',12)||':YWJj');
select pg_temp.assert_true((select count(*)=1 from public.documents),'atomic commit creates document');
select pg_temp.assert_true((select count(*)=1 from public.audit_logs where action='UPLOAD'),'server upload audit');
-- Duplicate commit fails rather than overwriting or adding unaudited versions.
do $$ begin
 begin
  perform public.commit_vault_version('33333333-3333-4333-8333-333333333333',1,'11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.enc',repeat('ab',12),'v2:'||repeat('ab',12)||':YWJj');
  raise exception 'duplicate commit accepted';
 exception when raise_exception then if sqlerrm='duplicate commit accepted' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.assert_true((select count(*)=0 from public.documents),'RLS hides other documents');
select pg_temp.assert_true((select count(*)=0 from public.document_versions),'RLS hides other versions');
select pg_temp.assert_true((select count(*)=0 from public.audit_logs),'RLS hides other audit');
do $$ begin
 begin
  insert into storage.objects(bucket_id,name,owner_id) values('vault_files','11111111-1111-4111-8111-111111111111/forbidden','22222222-2222-4222-8222-222222222222');
  raise exception 'cross-user upload accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.assert_true((select count(*)=1 from public.document_versions),'duplicate did not add versions');
select public.begin_vault_delete('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333');
select pg_temp.assert_true((select deleting from public.documents limit 1),'delete marks pending state');
select public.finish_vault_delete('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333');
select pg_temp.assert_true((select count(*)=0 from public.documents),'delete finalizes metadata');
select pg_temp.assert_true((select count(*)=0 from public.document_versions),'delete cascades versions');
select pg_temp.assert_true((select count(*)=2 from public.audit_logs),'delete retains audit history');
select pg_temp.assert_true((select bool_and(document_id is null) from public.audit_logs),'audit survives foreign key deletion');
select pg_temp.assert_true((select bool_and(public.reserve_vault_attempt('11111111-1111-4111-8111-111111111111')) from generate_series(1,30)),'first 30 attempts permitted');
select pg_temp.assert_true(not public.reserve_vault_attempt('11111111-1111-4111-8111-111111111111'),'attempt 31 denied');
delete from auth.users where id='11111111-1111-4111-8111-111111111111';
select pg_temp.assert_true((select count(*)=2 and bool_and(user_id is null) from public.audit_logs),'audit survives account deletion without retaining its user id');
rollback;

-- storage.buckets has RLS enabled with no policies out of the box, so the
-- storage service resolves no bucket for a normal user and every object call
-- fails with "Bucket not found" — even though the row exists and the
-- storage.objects policies are correct.
--
-- Members need to see the bucket's metadata to address it. This exposes the
-- bucket row only; object access is still governed by the per-path policies in
-- 20260908000400_models.sql, which check organization membership.

create policy "models_bucket_read" on storage.buckets
  for select
  to authenticated
  using (id = 'models');

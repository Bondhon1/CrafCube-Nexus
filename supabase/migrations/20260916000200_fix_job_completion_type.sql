-- Fix completing a print job.
--
-- 20260916000100 chose the ledger type with a CASE, which yields text, and
-- inserted it into an inventory_txn_type column. Every completion or failure
-- would have raised "column type is of type inventory_txn_type but expression
-- is of type text". Caught by running a real job through the function before
-- anything shipped; this reissues it with the cast and nothing else changed.

create or replace function public.set_job_status(
  p_job uuid,
  p_status public.print_job_status,
  p_note text default null,
  p_actual_grams numeric default null,
  p_actual_seconds integer default null,
  p_failed_quantity integer default null,
  p_failure_reason text default null
)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.print_jobs;
  v_from public.print_job_status;
  v_row record;
  v_product_est_total numeric;
  v_scale numeric;
  v_product numeric;
  v_waste numeric;
  v_kind text;
begin
  select * into v_job from public.print_jobs where id = p_job;
  if v_job.id is null then
    raise exception 'job not found';
  end if;

  if not public.has_role_at_least(v_job.organization_id, 'operator') then
    raise exception 'insufficient permissions to change job status';
  end if;

  v_from := v_job.status;
  if v_from = p_status then
    return v_job;
  end if;

  if v_from in ('COMPLETED', 'FAILED', 'CANCELLED') then
    raise exception 'job % is already %', v_job.code, v_from;
  end if;

  if p_status = 'PREPARING' then
    -- Nothing to reserve means the job cannot be accounted for at all.
    perform public.assert_job_has_materials(p_job);

    for v_row in
      select m.spool_id, m.estimated_grams
      from public.print_job_materials m
      where m.job_id = p_job and m.estimated_grams > 0
    loop
      if not exists (
        select 1 from public.filament_transactions
        where reference = 'job:' || p_job::text
          and spool_id = v_row.spool_id
          and type = 'RESERVATION'
      ) then
        -- Reserves product and waste alike: the purge leaves the same spool.
        insert into public.filament_transactions (
          organization_id, spool_id, type, grams, reason, reference
        ) values (
          v_job.organization_id, v_row.spool_id, 'RESERVATION', v_row.estimated_grams,
          'Reserved for ' || v_job.code, 'job:' || p_job::text
        );
      end if;
    end loop;
  end if;

  if p_status in ('COMPLETED', 'FAILED') then
    perform public.release_job_reservation(p_job);

    select coalesce(sum(greatest(m.estimated_grams
                                 - public.material_waste_total(m.estimated_waste), 0)), 0)
    into v_product_est_total
    from public.print_job_materials m where m.job_id = p_job;

    -- One measured weight is spread across spools in the proportions the
    -- slice predicted: an operator weighs the part, not each colour.
    v_scale := case
      when p_actual_grams is not null and v_product_est_total > 0
        then p_actual_grams / v_product_est_total
      else 1
    end;

    for v_row in
      select m.id, m.spool_id, m.estimated_grams, m.estimated_waste
      from public.print_job_materials m
      where m.job_id = p_job and m.estimated_grams > 0
    loop
      v_product := round(greatest(v_row.estimated_grams
                                  - public.material_waste_total(v_row.estimated_waste), 0)
                         * v_scale, 3);

      if v_product > 0 then
        insert into public.filament_transactions (
          organization_id, spool_id, type, grams, reason, reference, waste_kind
        ) values (
          v_job.organization_id, v_row.spool_id,
          -- A failed print used the material but must not enter production
          -- cost, so its product share is waste too (§25, §52).
          (case when p_status = 'COMPLETED' then 'CONSUMPTION' else 'WASTE' end)::public.inventory_txn_type,
          -v_product,
          case when p_status = 'COMPLETED'
            then 'Consumed by ' || v_job.code
            else coalesce(p_failure_reason, 'Failed print') || ' (' || v_job.code || ')'
          end,
          'job:' || p_job::text,
          case when p_status = 'COMPLETED' then null else 'failure' end
        );
      end if;

      -- Purge, support, brim and priming happened whether the print
      -- succeeded or not, so they are recorded as themselves either way.
      foreach v_kind in array array['purge', 'support', 'skirt_brim', 'prime_line'] loop
        v_waste := round(coalesce((v_row.estimated_waste ->> (v_kind || '_g'))::numeric, 0), 3);
        if v_waste > 0 then
          insert into public.filament_transactions (
            organization_id, spool_id, type, grams, reason, reference, waste_kind
          ) values (
            v_job.organization_id, v_row.spool_id, 'WASTE', -v_waste,
            initcap(replace(v_kind, '_', ' / ')) || ' for ' || v_job.code,
            'job:' || p_job::text, v_kind
          );
        end if;
      end loop;

      update public.print_job_materials
      set actual_grams = v_product + public.material_waste_total(v_row.estimated_waste)
      where id = v_row.id;
    end loop;
  end if;

  if p_status = 'CANCELLED' then
    perform public.release_job_reservation(p_job);
  end if;

  update public.print_jobs
  set status = p_status,
      started_at = case
        when p_status = 'PRINTING' and started_at is null then now() else started_at end,
      finished_at = case
        when p_status in ('COMPLETED', 'FAILED', 'CANCELLED') then now() else finished_at end,
      actual_grams = coalesce(p_actual_grams, actual_grams),
      actual_seconds = coalesce(p_actual_seconds, actual_seconds),
      failed_quantity = coalesce(p_failed_quantity, failed_quantity),
      failure_reason = coalesce(p_failure_reason, failure_reason)
  where id = p_job
  returning * into v_job;

  if v_job.custom_build_id is not null and p_status = 'COMPLETED' then
    update public.custom_builds set status = 'printed'
    where id = v_job.custom_build_id and status <> 'archived';
  end if;

  insert into public.print_job_events (organization_id, job_id, from_status, to_status, note, actor_id)
  values (v_job.organization_id, p_job, v_from, p_status, p_note, auth.uid());

  return v_job;
end;
$$;

notify pgrst, 'reload schema';

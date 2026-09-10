-- Stop clients writing `consumables.on_hand` directly.
--
-- The previous migration revoked UPDATE on that one column, which does
-- nothing on its own: a table-level UPDATE grant still covers every column,
-- and column-level revokes only remove column-level grants. So the cached
-- balance was still writable, which is precisely the drift phase 1 removed
-- from spools.
--
-- The fix is to drop the table-level grant and hand back only the columns a
-- person is supposed to edit. `on_hand` is then reachable solely through the
-- ledger trigger, which runs as SECURITY DEFINER and is unaffected.

revoke update on public.consumables from anon, authenticated;

grant update (name, unit, reorder_point, unit_cost, supplier, notes)
  on public.consumables to anon, authenticated;

notify pgrst, 'reload schema';

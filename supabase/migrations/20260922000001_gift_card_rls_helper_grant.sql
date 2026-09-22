-- The RLS reader must be allowed to execute this private helper.
-- The private schema is not exposed through PostgREST.
grant execute on function private.gift_card_staff_role() to authenticated;

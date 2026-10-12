-- Phase 2 D: in-place replacement of the existing order RPC; no rename window.
-- Baseline: pg_get_functiondef in production, signature
-- (jsonb,jsonb) RETURNS TABLE(order_id uuid,order_number text,created boolean),
-- SECURITY DEFINER, search_path pg_catalog/public, EXECUTE service_role only.
-- Only the receipt_legal_name INSERT field differs from the deployed body.
-- Legacy checkout payloads without receipt_legal_name remain accepted.
create or replace function public.create_kitchen_order_with_items(p_order jsonb,p_items jsonb)
returns table(order_id uuid,order_number text,created boolean)
language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  v_order_id uuid;
  v_order_number text;
begin
  if jsonb_typeof(p_order)<>'object'
    or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items)=0
    or nullif(p_order->>'order_number','') is null
    or nullif(p_order->>'checkout_id','') is null
    or coalesce(p_order->>'receipt_type','') not in ('boleta','factura')
    or (
      nullif(btrim(p_order->>'receipt_document_number'),'') is not null
      and (
        (p_order->>'receipt_type'='boleta' and btrim(p_order->>'receipt_document_number') !~ '^[0-9]{8}$')
        or (p_order->>'receipt_type'='factura' and btrim(p_order->>'receipt_document_number') !~ '^[0-9]{11}$')
      )
    ) then
    raise exception 'Invalid order payload';
  end if;

  insert into public.orders (
    order_number,checkout_id,customer_name,customer_email,customer_phone,
    order_type,delivery_address,delivery_reference,payment_method,
    payment_status,receipt_type,receipt_document_number,receipt_legal_name,
    status,subtotal,delivery_fee,total,discount_code,discount_percent,
    discount_amount,notes,created_at
  ) values (
    p_order->>'order_number',(p_order->>'checkout_id')::uuid,
    p_order->>'customer_name',nullif(p_order->>'customer_email',''),
    p_order->>'customer_phone',p_order->>'order_type',
    nullif(p_order->>'delivery_address',''),nullif(p_order->>'delivery_reference',''),
    p_order->>'payment_method',p_order->>'payment_status',
    p_order->>'receipt_type',nullif(btrim(p_order->>'receipt_document_number'),''),
    case when p_order->>'receipt_type'='factura' then nullif(btrim(p_order->>'receipt_legal_name'),'') else null end,
    'nuevo',(p_order->>'subtotal')::numeric,
    (p_order->>'delivery_fee')::numeric,(p_order->>'total')::numeric,
    nullif(p_order->>'discount_code',''),
    nullif(p_order->>'discount_percent','')::numeric,
    coalesce(nullif(p_order->>'discount_amount','')::numeric,0),
    nullif(p_order->>'notes',''),(p_order->>'created_at')::timestamptz
  )
  on conflict (checkout_id) where checkout_id is not null do nothing
  returning id,public.orders.order_number into v_order_id,v_order_number;

  if v_order_id is null then
    select o.id,o.order_number into v_order_id,v_order_number
      from public.orders o where o.checkout_id=(p_order->>'checkout_id')::uuid;
    return query select v_order_id,v_order_number,false;
    return;
  end if;

  insert into public.order_items(order_id,product_name,category,quantity,unit_price,notes)
  select v_order_id,item->>'product_name',item->>'category',
    (item->>'quantity')::integer,(item->>'unit_price')::numeric,
    nullif(item->>'notes','')
  from jsonb_array_elements(p_items) as item;

  return query select v_order_id,v_order_number,true;
end;
$$;
revoke all on function public.create_kitchen_order_with_items(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_kitchen_order_with_items(jsonb,jsonb) to service_role;

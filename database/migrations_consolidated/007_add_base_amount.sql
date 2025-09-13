-- 007_add_base_amount.sql
-- Adds base_amount to transactions and recalibrates totals to be base_amount + items_sum

BEGIN;

-- 1) Add base_amount column
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- 2) Backfill base_amount intelligently
-- Strategy: prefer customer's payment_info.amount; else paid+balance - items_sum; else (t.amount - items_sum); else t.amount; else 0
UPDATE transactions t
SET base_amount = COALESCE(
  -- Prefer customer's configured amount if present
  NULLIF(regexp_replace((c.payment_info::jsonb->>'amount'), '[^0-9\.-]', '', 'g'), '')::NUMERIC,
  -- Next, try paid + balance - items_sum
  GREATEST(COALESCE(t.paid_amount, 0) + COALESCE(t.balance_amount, 0) - COALESCE((SELECT SUM(ti.quantity * ti.unit_price) FROM transaction_items ti WHERE ti.transaction_id = t.id), 0), 0),
  -- Next, t.amount - items_sum (in case t.amount already includes items)
  GREATEST(COALESCE(t.amount, 0) - COALESCE((SELECT SUM(ti2.quantity * ti2.unit_price) FROM transaction_items ti2 WHERE ti2.transaction_id = t.id), 0), 0),
  -- Fallback to t.amount
  COALESCE(t.amount, 0),
  0
)
FROM customers c
WHERE t.customer_id = c.id;

-- 3) Recreate recalc_transaction_totals() to compute amount = base_amount + items_sum
CREATE OR REPLACE FUNCTION recalc_transaction_totals(p_transaction_id INTEGER)
RETURNS VOID AS $$
DECLARE
  v_items NUMERIC(14,2);
  v_base NUMERIC(14,2);
  v_paid NUMERIC(14,2);
  v_total NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_status TEXT;
BEGIN
  SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_items FROM transaction_items WHERE transaction_id = p_transaction_id;
  SELECT COALESCE(base_amount, 0) INTO v_base FROM transactions WHERE id = p_transaction_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payment_settlements WHERE transaction_id = p_transaction_id;

  v_total := COALESCE(v_base, 0) + COALESCE(v_items, 0);
  v_balance := GREATEST(v_total - v_paid, 0);
  v_status := CASE
                WHEN v_paid = 0 THEN 'unpaid'
                WHEN v_total > 0 AND v_paid >= v_total THEN 'paid'
                ELSE 'partial'
              END;

  UPDATE transactions
     SET amount = v_total,
         paid_amount = v_paid,
         balance_amount = v_balance,
         payment_status = v_status,
         updated_at = CURRENT_TIMESTAMP
   WHERE id = p_transaction_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;


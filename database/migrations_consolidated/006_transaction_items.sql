-- 006_transaction_items.sql
-- Create transaction_items table and triggers to keep transactions totals consistent

BEGIN;

-- Create table for transaction line items (add-ons)
CREATE TABLE IF NOT EXISTS transaction_items (
  id SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Helpful index
CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id ON transaction_items(transaction_id);

-- Ensure updated_at auto-updates
CREATE OR REPLACE FUNCTION set_transaction_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_transaction_items_updated_at ON transaction_items;
CREATE TRIGGER trg_set_transaction_items_updated_at
BEFORE UPDATE ON transaction_items
FOR EACH ROW
EXECUTE FUNCTION set_transaction_items_updated_at();

-- Recalc function to keep transactions in sync
CREATE OR REPLACE FUNCTION recalc_transaction_totals(p_transaction_id INTEGER)
RETURNS VOID AS $$
DECLARE
  v_amount NUMERIC(14,2);
  v_paid NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_status TEXT;
  v_items_count INTEGER;
  v_existing_amount NUMERIC(14,2);
BEGIN
  -- Count items and sum (quantity * unit_price)
  SELECT COUNT(*), COALESCE(SUM(quantity * unit_price), 0)
    INTO v_items_count, v_amount
    FROM transaction_items
   WHERE transaction_id = p_transaction_id;

  -- If no items exist, preserve existing amount instead of overwriting to 0
  IF COALESCE(v_items_count, 0) = 0 THEN
    SELECT amount INTO v_existing_amount FROM transactions WHERE id = p_transaction_id;
    v_amount := COALESCE(v_existing_amount, 0);
  END IF;

  -- Sum payments
  SELECT COALESCE(SUM(amount), 0)
    INTO v_paid
    FROM payment_settlements
   WHERE transaction_id = p_transaction_id;

  v_balance := GREATEST(v_amount - v_paid, 0);
  v_status := CASE
                WHEN v_paid = 0 THEN 'unpaid'
                WHEN v_amount > 0 AND v_paid >= v_amount THEN 'paid'
                ELSE 'partial'
              END;

  UPDATE transactions
     SET amount = v_amount,
         paid_amount = v_paid,
         balance_amount = v_balance,
         payment_status = v_status,
         updated_at = CURRENT_TIMESTAMP
   WHERE id = p_transaction_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger helper to determine affected transaction_id for transaction_items
CREATE OR REPLACE FUNCTION trg_recalc_transaction_from_items()
RETURNS TRIGGER AS $$
DECLARE
  v_tx_id INTEGER;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_tx_id := OLD.transaction_id;
  ELSE
    v_tx_id := NEW.transaction_id;
  END IF;

  PERFORM recalc_transaction_totals(v_tx_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_items_recalc_after_write ON transaction_items;
CREATE TRIGGER trg_items_recalc_after_write
AFTER INSERT OR UPDATE OR DELETE ON transaction_items
FOR EACH ROW
EXECUTE FUNCTION trg_recalc_transaction_from_items();

-- Optional: also recalc when settlements change to keep in sync
CREATE OR REPLACE FUNCTION trg_recalc_transaction_from_settlements()
RETURNS TRIGGER AS $$
DECLARE
  v_tx_id INTEGER;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_tx_id := OLD.transaction_id;
  ELSE
    v_tx_id := NEW.transaction_id;
  END IF;

  PERFORM recalc_transaction_totals(v_tx_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settlements_recalc_after_write ON payment_settlements;
CREATE TRIGGER trg_settlements_recalc_after_write
AFTER INSERT OR UPDATE OR DELETE ON payment_settlements
FOR EACH ROW
EXECUTE FUNCTION trg_recalc_transaction_from_settlements();

COMMIT;


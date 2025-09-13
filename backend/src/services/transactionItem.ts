import { pool } from '../config/database';
import { WebSocketService } from './websocket';
import { TransactionService } from './transaction';

export interface TransactionItem {
  id: number;
  transaction_id: number;
  item_name: string;
  description?: string | null;
  quantity: number;
  unit_price: number;
  created_at: Date;
  updated_at: Date;
}

export class TransactionItemService {
  static async list(transactionId: number): Promise<TransactionItem[]> {
    const q = `
      SELECT 
        id, transaction_id, item_name, description,
        CAST(quantity AS NUMERIC)::FLOAT as quantity,
        CAST(unit_price AS NUMERIC)::FLOAT as unit_price,
        created_at, updated_at
      FROM transaction_items
      WHERE transaction_id = $1
      ORDER BY id ASC
    `;
    const r = await pool.query(q, [transactionId]);
    return r.rows;
  }

  static async add(transactionId: number, item: { item_name: string; description?: string; quantity: number; unit_price: number; }): Promise<{ transaction: any, items: TransactionItem[] }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertQ = `
        INSERT INTO transaction_items (transaction_id, item_name, description, quantity, unit_price)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `;
      await client.query(insertQ, [transactionId, item.item_name, item.description || null, item.quantity, item.unit_price]);

      // Recalc and fetch updated transaction
      const updatedTx = await TransactionService.updatePaymentStatus(transactionId, undefined, client);

      const items = await client.query(`
        SELECT 
          id, transaction_id, item_name, description,
          CAST(quantity AS NUMERIC)::FLOAT as quantity,
          CAST(unit_price AS NUMERIC)::FLOAT as unit_price,
          created_at, updated_at
        FROM transaction_items
        WHERE transaction_id = $1
        ORDER BY id ASC
      `, [transactionId]);

      await client.query('COMMIT');

      // Emit update event
      WebSocketService.emitTransactionUpdate({
        type: 'transaction_items_updated',
        transaction: updatedTx,
        timestamp: new Date()
      });

      return { transaction: updatedTx, items: items.rows };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async update(transactionId: number, itemId: number, updates: Partial<{ item_name: string; description: string; quantity: number; unit_price: number; }>): Promise<{ transaction: any, item: TransactionItem }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const set: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) {
          set.push(`${k} = $${idx}`);
          vals.push(v);
          idx++;
        }
      }
      if (set.length === 0) throw new Error('No valid updates provided');

      vals.push(itemId, transactionId);
      const updateQ = `
        UPDATE transaction_items
           SET ${set.join(', ')}
         WHERE id = $${idx} AND transaction_id = $${idx + 1}
         RETURNING id, transaction_id, item_name, description,
                   CAST(quantity AS NUMERIC)::FLOAT as quantity,
                   CAST(unit_price AS NUMERIC)::FLOAT as unit_price,
                   created_at, updated_at
      `;
      const r = await client.query(updateQ, vals);
      if (r.rows.length === 0) throw new Error('Item not found');

      const updatedTx = await TransactionService.updatePaymentStatus(transactionId, undefined, client);

      await client.query('COMMIT');

      WebSocketService.emitTransactionUpdate({
        type: 'transaction_items_updated',
        transaction: updatedTx,
        timestamp: new Date()
      });

      return { transaction: updatedTx, item: r.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async remove(transactionId: number, itemId: number): Promise<{ transaction: any }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const del = await client.query(`DELETE FROM transaction_items WHERE id = $1 AND transaction_id = $2`, [itemId, transactionId]);
      if (del.rowCount === 0) throw new Error('Item not found');

      const updatedTx = await TransactionService.updatePaymentStatus(transactionId, undefined, client);

      await client.query('COMMIT');

      WebSocketService.emitTransactionUpdate({
        type: 'transaction_items_updated',
        transaction: updatedTx,
        timestamp: new Date()
      });

      return { transaction: updatedTx };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}


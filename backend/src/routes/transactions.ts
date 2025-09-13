import express, { Router, Response } from 'express';
import { TransactionService, ReportService } from '../services/transaction';
import { TransactionItemService } from '../services/transactionItem';
import { PaymentSettlementService } from '../services/paymentSettlementService';
import { authenticateToken, requireCashierOrAdmin, requireAdmin, logActivity } from '../middleware/auth';
import { AuthRequest, PaymentMode } from '../types';

const router: express.Router = Router();

// Create transaction
router.post('/', authenticateToken, requireCashierOrAdmin, logActivity('create_transaction'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const transactionData = {
      ...req.body,
      cashier_id: req.user!.id
    };

    const transaction = await TransactionService.create(transactionData);
    res.status(201).json(transaction);
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List transactions
router.get('/', authenticateToken, logActivity('list_transactions'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, paymentMode, salesAgentId, cashierId, customerId, page = '1', limit = '50' } = req.query;
    
    const filters = {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      paymentMode: paymentMode as PaymentMode,
      salesAgentId: salesAgentId ? parseInt(salesAgentId as string, 10) : undefined,
      cashierId: cashierId ? parseInt(cashierId as string, 10) : undefined,
      customerId: customerId ? parseInt(customerId as string, 10) : undefined,
      includePaymentDetails: true, // Include payment details for transaction listing
    };

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    const result = await TransactionService.list(filters, limitNum, offset);
    
    res.json({
      transactions: result.transactions,
      pagination: {
        current_page: pageNum,
        per_page: limitNum,
        total: result.total,
        total_pages: Math.ceil(result.total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error listing transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Get transaction by ID
router.get('/:id', authenticateToken, logActivity('get_transaction'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const txId = Number(id);
    if (!Number.isInteger(txId)) {
      res.status(400).json({ error: 'Invalid transaction id' });
      return;
    }

    const transaction = await TransactionService.findById(txId);

    if (!transaction) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    res.json(transaction);
  } catch (error) {
    console.error('Error getting transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get daily summary (supports either ?date=YYYY-MM-DD or ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD)
router.get('/reports/daily', authenticateToken, logActivity('get_daily_summary'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { date, startDate, endDate } = req.query as { date?: string; startDate?: string; endDate?: string };

    // Generate a correlation id for tracing
    const cid = `ROUTE_DAILYSUM_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Helper to validate YYYY-MM-DD (lenient: accepts full ISO but uses date part only)
    const parseDateInput = (input?: string): Date | undefined => {
      if (!input) return undefined;
      const d = new Date(input);
      return isNaN(d.getTime()) ? undefined : d;
    };

    let summary;
    if (startDate && endDate) {
      const start = parseDateInput(startDate);
      const end = parseDateInput(endDate);
      if (!start || !end) {
        res.status(400).json({ error: 'Invalid startDate or endDate. Use YYYY-MM-DD.' });
        return;
      }
      // Ensure start <= end
      if (start > end) {
        res.status(400).json({ error: 'startDate must be before or equal to endDate' });
        return;
      }
      console.log(`[${cid}] GET /reports/daily range: ${start.toISOString().split('T')[0]}..${end.toISOString().split('T')[0]} tz=Asia/Manila`);
      summary = await TransactionService.getSummaryRange(start, end, 'Asia/Manila');
    } else {
      const target = parseDateInput(date) || new Date();
      console.log(`[${cid}] GET /reports/daily date: ${target.toISOString().split('T')[0]} tz=Asia/Manila`);
      summary = await TransactionService.getDailySummary(target);
    }

    res.json(summary);
  } catch (error) {
    console.error('Error getting daily summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get monthly report
router.get('/reports/monthly', authenticateToken, requireAdmin, logActivity('get_monthly_report'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { year, month } = req.query;
    
    if (!year || !month) {
      res.status(400).json({ error: 'Year and month are required' });
      return;
    }

    const report = await TransactionService.getMonthlyReport(
      parseInt(year as string, 10),
      parseInt(month as string, 10)
    );
    
    res.json(report);
  } catch (error) {
    console.error('Error getting monthly report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get weekly report
router.get('/reports/weekly', authenticateToken, logActivity('get_weekly_report'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      res.status(400).json({ error: 'Start date and end date are required' });
      return;
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    
    const [summary, paymentStats] = await Promise.all([
      TransactionService.getDailySummary(start),
      TransactionService.getPaymentModeStats(start, end)
    ]);
    
    res.json({
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      summary,
      paymentStats
    });
  } catch (error) {
    console.error('Error getting weekly report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate daily report
router.post('/reports/daily', authenticateToken, requireAdmin, logActivity('generate_daily_report'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { date, expenses = [], funds = [], pettyCashStart = 0, pettyCashEnd = 0 } = req.body;
    
    const targetDate = date ? new Date(date) : new Date();
    
    const report = await ReportService.generateDailyReport(
      targetDate,
      expenses,
      funds,
      pettyCashStart,
      pettyCashEnd
    );
    
    await ReportService.saveDailyReport(report);
    
    res.json(report);
  } catch (error) {
    console.error('Error generating daily report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get saved daily report
router.get('/reports/daily/:date', authenticateToken, logActivity('get_saved_daily_report'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { date } = req.params;
    
    const report = await ReportService.getDailyReport(date);
    
    if (!report) {
      res.status(200).json({ exists: false });
      return;
    }
    
    res.json(report);
  } catch (error) {
    console.error('Error getting saved daily report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export transactions
router.post('/export', authenticateToken, logActivity('export_transactions'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { format, startDate, endDate, paymentMode, salesAgentId, cashierId } = req.body;
    
    if (!format || !['excel', 'pdf', 'csv'].includes(format)) {
      res.status(400).json({ error: 'Invalid export format. Supported formats: excel, pdf, csv' });
      return;
    }
    
    const filters = {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      paymentMode: paymentMode as PaymentMode,
      salesAgentId: salesAgentId ? parseInt(salesAgentId, 10) : undefined,
      cashierId: cashierId ? parseInt(cashierId, 10) : undefined,
      includePaymentDetails: true, // Include payment details for export
    };
    
    const result = await TransactionService.list(filters, 10000, 0); // Get all transactions
    
    // For now, return the data as JSON. In a real implementation, you would
    // generate the actual file format and return it as a download.
    res.json({
      format,
      exportedAt: new Date().toISOString(),
      totalRecords: result.total,
      data: result.transactions
    });
  } catch (error) {
    console.error('Error exporting transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Transaction Items (Add-ons)
router.get('/:id/items', authenticateToken, logActivity('list_transaction_items'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const txId = Number(req.params.id);
    if (!Number.isInteger(txId)) {
      res.status(400).json({ error: 'Invalid transaction id' });
      return;
    }
    const items = await TransactionItemService.list(txId);
    res.json(items);
  } catch (error) {
    console.error('Error listing transaction items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/items', authenticateToken, requireCashierOrAdmin, logActivity('add_transaction_item'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const txId = Number(req.params.id);
    if (!Number.isInteger(txId)) {
      res.status(400).json({ error: 'Invalid transaction id' });
      return;
    }

    const { item_name, description, quantity, unit_price } = req.body || {};
    if (!item_name || typeof item_name !== 'string') {
      res.status(400).json({ error: 'item_name is required' });
      return;
    }
    const qty = parseFloat(quantity);
    const price = parseFloat(unit_price);
    if (isNaN(qty) || qty <= 0) {
      res.status(400).json({ error: 'quantity must be a positive number' });
      return;
    }
    if (isNaN(price) || price < 0) {
      res.status(400).json({ error: 'unit_price must be a non-negative number' });
      return;
    }

    const result = await TransactionItemService.add(txId, { item_name, description, quantity: qty, unit_price: price });
    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding transaction item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/items/:itemId', authenticateToken, requireCashierOrAdmin, logActivity('update_transaction_item'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const txId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(txId) || !Number.isInteger(itemId)) {
      res.status(400).json({ error: 'Invalid id(s)' });
      return;
    }

    const updates: any = {};
    const { item_name, description, quantity, unit_price } = req.body || {};
    if (item_name !== undefined) updates.item_name = item_name;
    if (description !== undefined) updates.description = description;
    if (quantity !== undefined) {
      const q = parseFloat(quantity);
      if (isNaN(q) || q <= 0) { res.status(400).json({ error: 'quantity must be a positive number' }); return; }
      updates.quantity = q;
    }
    if (unit_price !== undefined) {
      const p = parseFloat(unit_price);
      if (isNaN(p) || p < 0) { res.status(400).json({ error: 'unit_price must be a non-negative number' }); return; }
      updates.unit_price = p;
    }

    const result = await TransactionItemService.update(txId, itemId, updates);
    res.json(result);
  } catch (error) {
    console.error('Error updating transaction item:', error);
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id/items/:itemId', authenticateToken, requireCashierOrAdmin, logActivity('delete_transaction_item'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const txId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(txId) || !Number.isInteger(itemId)) {
      res.status(400).json({ error: 'Invalid id(s)' });
      return;
    }

    const result = await TransactionItemService.remove(txId, itemId);
    res.json(result);
  } catch (error) {
    console.error('Error deleting transaction item:', error);
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new payment settlement
router.post('/:id/settlements', authenticateToken, requireCashierOrAdmin, logActivity('create_settlement'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { amount, payment_mode, cashier_id } = req.body;

    // Validate required fields
    if (!amount || !payment_mode || !cashier_id) {
      res.status(400).json({ error: 'Missing required fields: amount, payment_mode, cashier_id' });
      return;
    }

    // Validate transaction ID
    const transactionId = Number(id);
    if (!Number.isInteger(transactionId)) {
      res.status(400).json({ error: 'Invalid transaction id' });
      return;
    }

    // Validate amount
    const settlementAmount = parseFloat(amount);
    if (isNaN(settlementAmount) || settlementAmount <= 0) {
      res.status(400).json({ error: 'Amount must be a positive number' });
      return;
    }

    // Validate cashier_id
    const cashierIdInt = parseInt(cashier_id, 10);
    if (isNaN(cashierIdInt)) {
      res.status(400).json({ error: 'Invalid cashier ID' });
      return;
    }

    const result = await PaymentSettlementService.createSettlement(
      transactionId,
      settlementAmount,
      payment_mode,
      cashierIdInt
    );

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating payment settlement:', error);
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('Invalid') || error.message.includes('exceeds')) {
        res.status(400).json({ error: error.message });
        return;
      }
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete transaction (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, logActivity('delete_transaction'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    // Validate transaction ID
    const transactionId = Number(id);
    if (!Number.isInteger(transactionId)) {
      res.status(400).json({ error: 'Invalid transaction id' });
      return;
    }

    await TransactionService.delete(transactionId);
    res.status(204).send(); // No content response for successful deletion
  } catch (error) {
    console.error('Error deleting transaction:', error);
    
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all settlements for a transaction
router.get('/:id/settlements', authenticateToken, logActivity('get_settlements'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    // Validate transaction ID
    const transactionId = Number(id);
    if (!Number.isInteger(transactionId)) {
      res.status(400).json({ error: 'Invalid transaction id' });
      return;
    }

    const settlements = await PaymentSettlementService.getSettlements(transactionId);
    res.json(settlements);
  } catch (error) {
    console.error('Error getting settlements:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

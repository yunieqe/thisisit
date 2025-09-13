import express, { Router, Response } from 'express';
import { ActivityService } from '../services/activity';
import { NotificationService } from '../services/notification';
import { ReportService } from '../services/transaction';
import { authenticateToken, requireAdmin, logActivity } from '../middleware/auth';
import { AuthRequest, NotificationStatus } from '../types';
import { pool } from '../config/database';

const router: express.Router = Router();

// Get activity logs
router.get('/activity-logs', authenticateToken, requireAdmin, logActivity('view_activity_logs'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { action, startDate, endDate, page = '1', limit = '50' } = req.query;
    
    const filters = {
      action: action as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    };

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    const logs = await ActivityService.getAll(limitNum, offset, filters);
    
    res.json({
      logs,
      pagination: {
        current_page: pageNum,
        per_page: limitNum
      }
    });
  } catch (error) {
    console.error('Error getting activity logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clean old activity logs
router.delete('/activity-logs/cleanup', authenticateToken, requireAdmin, logActivity('cleanup_activity_logs'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { retentionDays = 90 } = req.body;
    const deletedCount = await ActivityService.deleteOldLogs(retentionDays);
    
    res.json({ 
      message: `Deleted ${deletedCount} old activity logs`,
      deletedCount 
    });
  } catch (error) {
    console.error('Error cleaning up activity logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SMS Templates management
router.get('/sms-templates', authenticateToken, requireAdmin, logActivity('list_sms_templates'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const templates = await NotificationService.listSMSTemplates();
    res.json(templates);
  } catch (error) {
    console.error('Error listing SMS templates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sms-templates', authenticateToken, requireAdmin, logActivity('create_sms_template'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, template, variables } = req.body;
    
    if (!name || !template || !variables) {
      res.status(400).json({ error: 'Name, template, and variables are required' });
      return;
    }

    const smsTemplate = await NotificationService.createSMSTemplate({
      name,
      template,
      variables
    });
    
    res.status(201).json(smsTemplate);
  } catch (error) {
    console.error('Error creating SMS template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/sms-templates/:id', authenticateToken, requireAdmin, logActivity('update_sms_template'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const templateId = Number(id);
    if (!Number.isInteger(templateId)) {
      res.status(400).json({ error: 'Invalid template id' });
      return;
    }

    const updates = req.body;
    
    const template = await NotificationService.updateSMSTemplate(templateId, updates);
    res.json(template);
  } catch (error) {
    console.error('Error updating SMS template:', error);
    if (error instanceof Error && error.message === 'SMS template not found') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Delete daily report
router.delete('/reports/daily/:date', authenticateToken, requireAdmin, logActivity('delete_daily_report'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { date } = req.params;

    const deleted = await ReportService.deleteDailyReport(date);

    if (!deleted) {
      res.status(404).json({ error: 'Daily report not found' });
      return;
    }

    res.status(204).send(); // No content response for successful deletion
  } catch (error) {
    console.error('Error deleting daily report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Notification logs
router.get('/notification-logs', authenticateToken, requireAdmin, logActivity('view_notification_logs'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { customerId, status, startDate, endDate, page = '1', limit = '50' } = req.query;
    
    const filters = {
      customerId: customerId ? parseInt(customerId as string, 10) : undefined,
      status: status as NotificationStatus | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    };

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    const result = await NotificationService.getNotificationLogs(filters, limitNum, offset);
    
    res.json({
      logs: result.logs,
      pagination: {
        current_page: pageNum,
        per_page: limitNum,
        total: result.total,
        total_pages: Math.ceil(result.total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error getting notification logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize default SMS templates
router.post('/initialize-templates', authenticateToken, requireAdmin, logActivity('initialize_sms_templates'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await NotificationService.initializeDefaultTemplates();
    res.json({ message: 'Default SMS templates initialized successfully' });
  } catch (error) {
    console.error('Error initializing SMS templates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// System health check
router.get('/health', authenticateToken, requireAdmin, logActivity('system_health_check'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Basic health check - could be expanded with more checks
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version
    };
    
    res.json(health);
  } catch (error) {
    console.error('Error in health check:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fix existing transactions with zero amounts
router.post('/fix-transactions', authenticateToken, requireAdmin, logActivity('fix_transactions'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { action } = req.body;
    
    if (action !== 'fix_balance_amounts') {
      res.status(400).json({ error: 'Invalid action' });
      return;
    }

    console.log(`[ADMIN_FIX] ${req.user?.full_name} initiated transaction balance fix`);

    // Step 1: Check current state
    const checkQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN amount = 0 OR amount IS NULL THEN 1 END) as zero_amounts,
        COUNT(CASE WHEN balance_amount = 0 OR balance_amount IS NULL THEN 1 END) as zero_balance
      FROM transactions
    `;
    
    const checkResult = await pool.query(checkQuery);
    const beforeStats = checkResult.rows[0];

    console.log(`[ADMIN_FIX] Before fix - Total: ${beforeStats.total}, Zero amounts: ${beforeStats.zero_amounts}, Zero balance: ${beforeStats.zero_balance}`);

    // Step 2: Fix transactions with zero amounts by getting the amount from customer payment_info
    const fixAmountsQuery = `
      UPDATE transactions 
      SET amount = (
        SELECT COALESCE((c.payment_info->>'amount')::numeric, 1500)
        FROM customers c 
        WHERE c.id = transactions.customer_id
      )
      WHERE amount = 0 OR amount IS NULL
    `;
    
    const fixAmountsResult = await pool.query(fixAmountsQuery);
    console.log(`[ADMIN_FIX] Fixed ${fixAmountsResult.rowCount} transactions with zero amounts`);

    // Step 3: Fix balance amounts
    const fixBalanceQuery = `
      UPDATE transactions 
      SET balance_amount = amount - COALESCE(paid_amount, 0)
      WHERE balance_amount = 0 
         OR balance_amount IS NULL 
         OR balance_amount != (amount - COALESCE(paid_amount, 0))
    `;
    
    const fixBalanceResult = await pool.query(fixBalanceQuery);
    console.log(`[ADMIN_FIX] Fixed ${fixBalanceResult.rowCount} transactions with incorrect balance amounts`);

    // Step 4: Verify the fix
    const verifyResult = await pool.query(checkQuery);
    const afterStats = verifyResult.rows[0];

    console.log(`[ADMIN_FIX] After fix - Total: ${afterStats.total}, Zero amounts: ${afterStats.zero_amounts}, Zero balance: ${afterStats.zero_balance}`);

    // Step 5: Get sample of fixed transactions
    const sampleQuery = `
      SELECT 
        id, or_number, amount, paid_amount, balance_amount, payment_status,
        (SELECT name FROM customers WHERE id = transactions.customer_id) as customer_name
      FROM transactions 
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 5
    `;
    
    const sampleResult = await pool.query(sampleQuery);

    res.json({
      success: true,
      message: 'Transaction amounts fixed successfully',
      stats: {
        before: beforeStats,
        after: afterStats,
        fixed_amounts: fixAmountsResult.rowCount,
        fixed_balance: fixBalanceResult.rowCount
      },
      sample_transactions: sampleResult.rows
    });

  } catch (error) {
    console.error('Error fixing transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dropdown Management - Grade Types
router.get('/dropdowns/grade-types', authenticateToken, requireAdmin, logActivity('list_grade_types'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = 'SELECT * FROM grade_types ORDER BY name ASC';
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listing grade types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/grade-types', authenticateToken, requireAdmin, logActivity('list_grade_types'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = 'SELECT * FROM grade_types ORDER BY name ASC';
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listing grade types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/grade-types', authenticateToken, requireAdmin, logActivity('create_grade_type'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description } = req.body;
    
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const query = `
      INSERT INTO grade_types (name, description)
      VALUES ($1, $2)
      RETURNING *
    `;
    
    const result = await pool.query(query, [name, description || null]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating grade type:', error);
    if ((error as any).code === '23505') { // Unique violation
      res.status(409).json({ error: 'Grade type with this name already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.put('/grade-types/:id', authenticateToken, requireAdmin, logActivity('update_grade_type'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const query = `
      UPDATE grade_types 
      SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;
    
    const gradeTypeId = Number(id);
    if (!Number.isInteger(gradeTypeId)) {
      res.status(400).json({ error: 'Invalid grade type id' });
      return;
    }

    const result = await pool.query(query, [name, description || null, gradeTypeId]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Grade type not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating grade type:', error);
    if ((error as any).code === '23505') { // Unique violation
      res.status(409).json({ error: 'Grade type with this name already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.delete('/grade-types/:id', authenticateToken, requireAdmin, logActivity('delete_grade_type'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const gradeTypeId = Number(id);
    if (!Number.isInteger(gradeTypeId)) {
      res.status(400).json({ error: 'Invalid grade type id' });
      return;
    }
    
    const query = 'DELETE FROM grade_types WHERE id = $1';
    const result = await pool.query(query, [gradeTypeId]);
    
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Grade type not found' });
      return;
    }
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting grade type:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dropdown Management - Lens Types
router.get('/dropdowns/lens-types', authenticateToken, requireAdmin, logActivity('list_lens_types'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = 'SELECT * FROM lens_types ORDER BY name ASC';
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listing lens types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/lens-types', authenticateToken, requireAdmin, logActivity('list_lens_types'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = 'SELECT * FROM lens_types ORDER BY name ASC';
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listing lens types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/lens-types', authenticateToken, requireAdmin, logActivity('create_lens_type'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description } = req.body;
    
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const query = `
      INSERT INTO lens_types (name, description)
      VALUES ($1, $2)
      RETURNING *
    `;
    
    const result = await pool.query(query, [name, description || null]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating lens type:', error);
    if ((error as any).code === '23505') { // Unique violation
      res.status(409).json({ error: 'Lens type with this name already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.put('/lens-types/:id', authenticateToken, requireAdmin, logActivity('update_lens_type'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const query = `
      UPDATE lens_types 
      SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;
    
    const lensTypeId = Number(id);
    if (!Number.isInteger(lensTypeId)) {
      res.status(400).json({ error: 'Invalid lens type id' });
      return;
    }

    const result = await pool.query(query, [name, description || null, lensTypeId]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Lens type not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating lens type:', error);
    if ((error as any).code === '23505') { // Unique violation
      res.status(409).json({ error: 'Lens type with this name already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.delete('/lens-types/:id', authenticateToken, requireAdmin, logActivity('delete_lens_type'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const lensTypeId = Number(id);
    if (!Number.isInteger(lensTypeId)) {
      res.status(400).json({ error: 'Invalid lens type id' });
      return;
    }
    
    const query = 'DELETE FROM lens_types WHERE id = $1';
    const result = await pool.query(query, [lensTypeId]);
    
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Lens type not found' });
      return;
    }
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting lens type:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Counter Management
router.get('/counters', authenticateToken, requireAdmin, logActivity('list_counters'), async (req: AuthRequest, res: Response): Promise<void> => {
  console.log('Getting counters - user:', req.user ? req.user.id : 'none');
  try {
    const query = 'SELECT * FROM counters ORDER BY display_order ASC, name ASC';
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listing counters:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/counters', authenticateToken, requireAdmin, logActivity('create_counter'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, displayOrder, isActive = true } = req.body;
    
    console.log('Creating counter with data:', { name, displayOrder, isActive });
    
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const query = `
      INSERT INTO counters (name, display_order, is_active)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    
    console.log('Executing query:', query);
    console.log('With parameters:', [name, displayOrder || 0, isActive]);
    
    const result = await pool.query(query, [name, displayOrder || 0, isActive]);
    console.log('Query result:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating counter:', error);
    console.error('Error details:', {
      message: (error as any).message,
      code: (error as any).code,
      detail: (error as any).detail
    });
    if ((error as any).code === '23505') { // Unique violation
      res.status(409).json({ error: 'Counter with this name already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.put('/counters/:id', authenticateToken, requireAdmin, logActivity('update_counter'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, displayOrder, isActive } = req.body;
    
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const query = `
      UPDATE counters 
      SET name = $1, display_order = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;
    
    const counterId = Number(id);
    if (!Number.isInteger(counterId)) {
      res.status(400).json({ error: 'Invalid counter id' });
      return;
    }

    const result = await pool.query(query, [name, displayOrder || 0, isActive, counterId]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Counter not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating counter:', error);
    if ((error as any).code === '23505') { // Unique violation
      res.status(409).json({ error: 'Counter with this name already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.put('/counters/:id/toggle', authenticateToken, requireAdmin, logActivity('toggle_counter'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const counterId = Number(id);
    if (!Number.isInteger(counterId)) {
      res.status(400).json({ error: 'Invalid counter id' });
      return;
    }
    
    const query = `
      UPDATE counters 
      SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await pool.query(query, [counterId]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Counter not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error toggling counter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/counters/:id', authenticateToken, requireAdmin, logActivity('delete_counter'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const counterId = Number(id);
    if (!Number.isInteger(counterId)) {
      res.status(400).json({ error: 'Invalid counter id' });
      return;
    }
    
    const query = 'DELETE FROM counters WHERE id = $1';
    const result = await pool.query(query, [counterId]);
    
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Counter not found' });
      return;
    }
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting counter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

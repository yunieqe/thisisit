import express, { Router, Request, Response } from 'express';
import { QueueAnalyticsService } from '../services/QueueAnalyticsService';
import { EnhancedSMSService } from '../services/EnhancedSMSService';
import { DailyQueueResetService } from '../services/DailyQueueResetService';
import { authenticateToken, requireRole } from '../middleware/auth';
import { UserRole } from '../types';
import { pool } from '../config/database';

const router: express.Router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * Get comprehensive analytics dashboard
 */
router.get('/dashboard', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateRange: { start: string; end: string } | undefined;
    if (startDate && endDate) {
      dateRange = {
        start: startDate as string,
        end: endDate as string
      };
    }

    const dashboard = await QueueAnalyticsService.getAnalyticsDashboard(dateRange);
    res.json(dashboard);
  } catch (error) {
    console.error('Error fetching analytics dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch analytics dashboard' });
  }
});

/**
 * Get hourly queue analytics
 */
router.get('/hourly', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      res.status(400).json({ error: 'startDate and endDate are required' });
      return;
    }

    const analytics = await QueueAnalyticsService.getQueueAnalytics(
      startDate as string,
      endDate as string
    );
    
    res.json(analytics);
  } catch (error) {
    console.error('Error fetching hourly analytics:', error);
    res.status(500).json({ error: 'Failed to fetch hourly analytics' });
  }
});

/**
 * Get daily queue summaries
 */
router.get('/daily', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      res.status(400).json({ error: 'startDate and endDate are required' });
      return;
    }

    const summaries = await QueueAnalyticsService.getDailySummaries(
      startDate as string,
      endDate as string
    );
    
    res.json(summaries);
  } catch (error) {
    console.error('Error fetching daily summaries:', error);
    res.status(500).json({ error: 'Failed to fetch daily summaries' });
  }
});

/**
 * Update daily summary (manual trigger)
 */
router.post('/update-daily-summary', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.body;
    
    await QueueAnalyticsService.updateDailySummary(date);
    res.json({ message: 'Daily summary updated successfully' });
  } catch (error) {
    console.error('Error updating daily summary:', error);
    res.status(500).json({ error: 'Failed to update daily summary' });
  }
});

/**
 * Export analytics data
 */
router.get('/export', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, type = 'daily', format = 'json' } = req.query;
    
    if (!startDate || !endDate) {
      res.status(400).json({ error: 'startDate and endDate are required' });
      return;
    }

    const data = await QueueAnalyticsService.exportAnalytics(
      startDate as string,
      endDate as string,
      type as 'hourly' | 'daily'
    );

    if (format === 'csv') {
      // Convert to CSV format
      if (data.length === 0) {
        res.status(404).json({ error: 'No data found for the specified date range' });
        return;
      }

      // Define improved headers for better readability
      const headerMapping: { [key: string]: string } = {
        'date': 'Date',
        'hour': 'Hour',
        'totalCustomers': 'Total Customers',
        'priorityCustomers': 'Priority Customers',
        'avgWaitTimeMinutes': 'Avg Wait Time (min)',
        'avgServiceTimeMinutes': 'Avg Service Time (min)',
        'peakQueueLength': 'Peak Queue Length',
        'customersServed': 'Customers Served',
        'avgProcessingDurationMinutes': 'Avg Processing Duration (min)',
        'totalProcessingCount': 'Total Processing Count',
        'maxProcessingDurationMinutes': 'Max Processing Duration (min)',
        'minProcessingDurationMinutes': 'Min Processing Duration (min)',
        'peakHour': 'Peak Hour',
        'busiestCounterId': 'Busiest Counter ID'
      };

      const originalHeaders = Object.keys(data[0]);
      const friendlyHeaders = originalHeaders.map(header => headerMapping[header] || header);
      
      const csvData = [
        friendlyHeaders.join(','),
        ...data.map(row =>
          originalHeaders.map(header => {
            const value = row[header];
            // Handle null/undefined values and format numbers
            if (value === null || value === undefined) {
              return '0';
            }
            if (typeof value === 'string') {
              return `"${value.replace(/"/g, '""')}"`; // Escape quotes in CSV
            }
            if (typeof value === 'number') {
              return parseFloat(value.toFixed(2)); // Round to 2 decimal places
            }
            return value;
          }).join(',')
        )
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=queue-analytics-${type}-${startDate}-${endDate}.csv`);
      // Add BOM for proper Excel compatibility
      res.send('\uFEFF' + csvData);
    } else {
      res.json(data);
    }
  } catch (error) {
    console.error('Error exporting analytics:', error);
    res.status(500).json({ error: 'Failed to export analytics data' });
  }
});

/**
 * Record queue event (for integration with queue management)
 */
router.post('/record-event', requireRole([UserRole.ADMIN, UserRole.SALES, UserRole.CASHIER]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId, eventType, counterId, queuePosition, waitTimeMinutes, serviceTimeMinutes, isPriority } = req.body;
    
    if (!customerId || !eventType) {
      res.status(400).json({ error: 'customerId and eventType are required' });
      return;
    }

    await QueueAnalyticsService.recordQueueEvent({
      customerId,
      eventType,
      counterId,
      queuePosition,
      waitTimeMinutes,
      serviceTimeMinutes,
      isPriority: isPriority || false
    });

    res.json({ message: 'Queue event recorded successfully' });
  } catch (error) {
    console.error('Error recording queue event:', error);
    res.status(500).json({ error: 'Failed to record queue event' });
  }
});

/**
 * Get SMS statistics
 */
router.get('/sms-stats', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateRange: { start: string; end: string } | undefined;
    if (startDate && endDate) {
      dateRange = {
        start: startDate as string,
        end: endDate as string
      };
    }

    const stats = await EnhancedSMSService.getSMSStats(dateRange);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching SMS stats:', error);
    res.status(500).json({ error: 'Failed to fetch SMS statistics' });
  }
});

/**
 * Get SMS templates
 */
router.get('/sms-templates', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const templates = await EnhancedSMSService.getTemplates();
    res.json(templates);
  } catch (error) {
    console.error('Error fetching SMS templates:', error);
    res.status(500).json({ error: 'Failed to fetch SMS templates' });
  }
});

/**
 * Update SMS template
 */
router.put('/sms-templates/:templateName', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { templateName } = req.params;
    const { templateContent } = req.body;
    
    if (!templateContent) {
      res.status(400).json({ error: 'templateContent is required' });
      return;
    }

    await EnhancedSMSService.updateTemplate(templateName, templateContent);
    res.json({ message: 'SMS template updated successfully' });
  } catch (error) {
    console.error('Error updating SMS template:', error);
    res.status(500).json({ error: 'Failed to update SMS template' });
  }
});

/**
 * Get recent SMS notifications
 */
router.get('/sms-notifications', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 50 } = req.query;
    
    const result = await EnhancedSMSService.getRecentNotifications(
      parseInt(page as string),
      parseInt(limit as string)
    );
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching SMS notifications:', error);
    res.status(500).json({ error: 'Failed to fetch SMS notifications' });
  }
});

/**
 * Get queue activities log
 */
router.get('/queue-activities', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    
    let dateFilter = '';
    let params: any[] = [];
    
    if (startDate && endDate) {
      dateFilter = 'WHERE DATE(qe.created_at) BETWEEN $1 AND $2';
      params = [startDate, endDate, parseInt(limit as string)];
    } else {
      dateFilter = 'WHERE DATE(qe.created_at) = CURRENT_DATE';
      params = [parseInt(limit as string)];
    }
    
    const query = `
      SELECT 
        qe.id,
        qe.customer_id,
        qe.event_type,
        qe.queue_position,
        qe.wait_time_minutes,
        qe.service_time_minutes,
        qe.is_priority,
        qe.created_at,
        c.name as counter_name,
        COALESCE(cust.name, 'Unknown Customer') as customer_name,
        COALESCE(cust.or_number, 'N/A') as or_number
      FROM queue_events qe
      LEFT JOIN counters c ON qe.counter_id = c.id
      LEFT JOIN customers cust ON qe.customer_id = cust.id
      ${dateFilter}
      ORDER BY qe.created_at DESC
      LIMIT $${params.length}
    `;
    
    const result = await pool.query(query, params);
    
    res.json({
      activities: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching queue activities:', error);
    res.status(500).json({ error: 'Failed to fetch queue activities' });
  }
});

/**
 * Get customer notification history
 */
router.get('/sms-notifications/customer/:customerId', requireRole([UserRole.ADMIN, UserRole.SALES]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId } = req.params;
    
    const notifications = await EnhancedSMSService.getCustomerNotificationHistory(
      parseInt(customerId)
    );
    
    res.json(notifications);
  } catch (error) {
    console.error('Error fetching customer notification history:', error);
    res.status(500).json({ error: 'Failed to fetch customer notification history' });
  }
});

/**
 * Retry failed SMS notifications
 */
router.post('/sms-notifications/retry-failed', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { maxRetries = 5 } = req.body;
    
    const successCount = await EnhancedSMSService.retryFailedNotifications(maxRetries);
    
    res.json({ 
      message: `Retry completed. ${successCount} notifications sent successfully.`,
      successCount 
    });
  } catch (error) {
    console.error('Error retrying failed SMS notifications:', error);
    res.status(500).json({ error: 'Failed to retry SMS notifications' });
  }
});

/**
 * Get daily queue history from scheduler archival
 */
router.get('/daily-queue-history', requireRole([UserRole.ADMIN, UserRole.SALES, UserRole.CASHIER]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { days = 30 } = req.query;
    
    const history = await DailyQueueResetService.getDailyHistory(parseInt(days as string));
    
    res.json({
      success: true,
      data: history,
      days: parseInt(days as string),
      description: 'Daily queue history from automatic scheduler archival'
    });
  } catch (error) {
    console.error('Error fetching daily queue history:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch daily queue history' 
    });
  }
});

/**
 * Get display monitor history from scheduler archival
 */
router.get('/display-monitor-history', requireRole([UserRole.ADMIN, UserRole.SALES, UserRole.CASHIER]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { days = 30 } = req.query;
    
    const history = await DailyQueueResetService.getDisplayMonitorHistory(parseInt(days as string));
    
    res.json({
      success: true,
      data: history,
      days: parseInt(days as string),
      description: 'Display monitor performance history from daily scheduler'
    });
  } catch (error) {
    console.error('Error fetching display monitor history:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch display monitor history' 
    });
  }
});

/**
 * Get customer history archives
 */
router.get('/customer-history', requireRole([UserRole.ADMIN, UserRole.SALES, UserRole.CASHIER]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { days = 30, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    
    const query = `
      SELECT 
        id,
        original_customer_id,
        name,
        email,
        phone,
        queue_status,
        token_number,
        priority_flags,
        estimated_wait_time as wait_time_minutes,
        served_at,
        counter_id,
        archive_date,
        created_at,
        archived_at
      FROM customer_history
      WHERE archive_date >= CURRENT_DATE - INTERVAL '${parseInt(days as string)} days'
      ORDER BY archive_date DESC, created_at DESC
      LIMIT $1 OFFSET $2
    `;
    
    const countQuery = `
      SELECT COUNT(*) as total
      FROM customer_history
      WHERE archive_date >= CURRENT_DATE - INTERVAL '${parseInt(days as string)} days'
    `;
    
    const [historyResult, countResult] = await Promise.all([
      pool.query(query, [parseInt(limit as string), offset]),
      pool.query(countQuery)
    ]);
    
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / parseInt(limit as string));
    
    res.json({
      success: true,
      data: historyResult.rows,
      pagination: {
        current_page: parseInt(page as string),
        total_pages: totalPages,
        total_records: total,
        per_page: parseInt(limit as string),
        has_next: parseInt(page as string) < totalPages,
        has_prev: parseInt(page as string) > 1
      },
      days: parseInt(days as string),
      description: 'Archived customer records from daily queue resets'
    });
  } catch (error) {
    console.error('Error fetching customer history:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch customer history' 
    });
  }
});

/**
 * Get daily reset logs
 */
router.get('/daily-reset-logs', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { days = 30 } = req.query;
    
    const query = `
      SELECT 
        id,
        reset_date,
        customers_archived,
        customers_carried_forward,
        queues_reset,
        success,
        error_message,
        duration_ms,
        created_at
      FROM daily_reset_log
      WHERE reset_date >= CURRENT_DATE - INTERVAL '${parseInt(days as string)} days'
      ORDER BY reset_date DESC
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: result.rows,
      days: parseInt(days as string),
      description: 'Daily queue reset operation logs from scheduler'
    });
  } catch (error) {
    console.error('Error fetching daily reset logs:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch daily reset logs' 
    });
  }
});

/**
 * Initialize historical analytics database tables (migration endpoint)
 */
router.post('/init-historical-tables', requireRole([UserRole.ADMIN]), async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('Initializing historical analytics tables...');
    
    // Create daily_queue_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_queue_history (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        total_customers INTEGER DEFAULT 0,
        waiting_customers INTEGER DEFAULT 0,
        serving_customers INTEGER DEFAULT 0,
        processing_customers INTEGER DEFAULT 0,
        completed_customers INTEGER DEFAULT 0,
        cancelled_customers INTEGER DEFAULT 0,
        priority_customers INTEGER DEFAULT 0,
        avg_wait_time_minutes DECIMAL(10,2) DEFAULT 0,
        peak_queue_length INTEGER DEFAULT 0,
        operating_hours INTEGER DEFAULT 8,
        archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create display_monitor_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS display_monitor_history (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        daily_customers_served INTEGER DEFAULT 0,
        daily_avg_wait_time INTEGER DEFAULT 0,
        daily_peak_queue_length INTEGER DEFAULT 0,
        daily_priority_customers INTEGER DEFAULT 0,
        operating_efficiency INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create customer_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_history (
        id SERIAL PRIMARY KEY,
        original_customer_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        queue_status VARCHAR(50),
        token_number INTEGER,
        priority_flags JSONB DEFAULT '{}',
        estimated_wait_time INTEGER DEFAULT 0,
        served_at TIMESTAMP,
        counter_id INTEGER,
        archive_date DATE NOT NULL,
        created_at TIMESTAMP,
        archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(original_customer_id, archive_date)
      );
    `);
    
    // Create daily_reset_log table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_reset_log (
        id SERIAL PRIMARY KEY,
        reset_date DATE NOT NULL,
        customers_archived INTEGER DEFAULT 0,
        customers_carried_forward INTEGER DEFAULT 0,
        customers_processed INTEGER DEFAULT 0,
        queues_reset INTEGER DEFAULT 0,
        success BOOLEAN DEFAULT true,
        error_message TEXT,
        duration_ms INTEGER DEFAULT 0,
        reset_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_daily_queue_history_date ON daily_queue_history(date DESC);',
      'CREATE INDEX IF NOT EXISTS idx_display_monitor_history_date ON display_monitor_history(date DESC);',
      'CREATE INDEX IF NOT EXISTS idx_customer_history_archive_date ON customer_history(archive_date DESC);',
      'CREATE INDEX IF NOT EXISTS idx_customer_history_original_id ON customer_history(original_customer_id);',
      'CREATE INDEX IF NOT EXISTS idx_daily_reset_log_date ON daily_reset_log(reset_date DESC);',
      'CREATE INDEX IF NOT EXISTS idx_daily_reset_log_success ON daily_reset_log(success);'
    ];
    
    for (const indexQuery of indexes) {
      await pool.query(indexQuery);
    }
    
    // Add sample data for immediate testing
    const dataCheck = await pool.query('SELECT COUNT(*) as count FROM daily_queue_history');
    
    if (parseInt(dataCheck.rows[0].count) === 0) {
      // Add sample data for last 30 days
      await pool.query(`
        INSERT INTO daily_queue_history (
          date, total_customers, waiting_customers, serving_customers, 
          processing_customers, completed_customers, cancelled_customers,
          priority_customers, avg_wait_time_minutes, peak_queue_length, operating_hours
        )
        SELECT 
          (CURRENT_DATE - INTERVAL '1 day' * generate_series(0, 29))::DATE as date,
          (20 + RANDOM() * 30)::INTEGER as total_customers,
          (2 + RANDOM() * 5)::INTEGER as waiting_customers,
          (1 + RANDOM() * 3)::INTEGER as serving_customers,
          (0 + RANDOM() * 2)::INTEGER as processing_customers,
          (15 + RANDOM() * 25)::INTEGER as completed_customers,
          (0 + RANDOM() * 3)::INTEGER as cancelled_customers,
          (5 + RANDOM() * 10)::INTEGER as priority_customers,
          (8 + RANDOM() * 12)::DECIMAL(10,2) as avg_wait_time_minutes,
          (8 + RANDOM() * 15)::INTEGER as peak_queue_length,
          8 as operating_hours
      `);
      
      await pool.query(`
        INSERT INTO display_monitor_history (
          date, daily_customers_served, daily_avg_wait_time, 
          daily_peak_queue_length, daily_priority_customers, operating_efficiency
        )
        SELECT 
          (CURRENT_DATE - INTERVAL '1 day' * generate_series(0, 29))::DATE as date,
          (15 + RANDOM() * 25)::INTEGER as daily_customers_served,
          (8 + RANDOM() * 12)::INTEGER as daily_avg_wait_time,
          (8 + RANDOM() * 15)::INTEGER as daily_peak_queue_length,
          (5 + RANDOM() * 10)::INTEGER as daily_priority_customers,
          (75 + RANDOM() * 20)::INTEGER as operating_efficiency
      `);
      
      await pool.query(`
        INSERT INTO daily_reset_log (
          reset_date, customers_archived, customers_carried_forward, 
          customers_processed, queues_reset, success, duration_ms
        )
        SELECT 
          (CURRENT_DATE - INTERVAL '1 day' * generate_series(1, 30))::DATE as reset_date,
          (15 + RANDOM() * 25)::INTEGER as customers_archived,
          (2 + RANDOM() * 5)::INTEGER as customers_carried_forward,
          (18 + RANDOM() * 28)::INTEGER as customers_processed,
          2 as queues_reset,
          true as success,
          (500 + RANDOM() * 1500)::INTEGER as duration_ms
      `);
    }
    
    res.json({
      success: true,
      message: 'Historical analytics tables initialized successfully',
      tablesCreated: ['daily_queue_history', 'display_monitor_history', 'customer_history', 'daily_reset_log'],
      indexesCreated: 6,
      sampleDataAdded: parseInt(dataCheck.rows[0].count) === 0
    });
    
  } catch (error) {
    console.error('Error initializing historical analytics tables:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to initialize historical analytics tables',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Get comprehensive historical analytics dashboard
 */
router.get('/historical-dashboard', requireRole([UserRole.ADMIN, UserRole.SALES, UserRole.CASHIER]), async (req: Request, res: Response): Promise<void> => {
  try {
    const { days = 30 } = req.query;
    const numDays = parseInt(days as string);
    
    // Fetch all historical data in parallel
    const [queueHistory, monitorHistory, resetLogs] = await Promise.all([
      DailyQueueResetService.getDailyHistory(numDays),
      DailyQueueResetService.getDisplayMonitorHistory(numDays),
      pool.query(`
        SELECT * FROM daily_reset_log 
        WHERE reset_date >= CURRENT_DATE - INTERVAL '${numDays} days'
        ORDER BY reset_date DESC
      `)
    ]);
    
    // Calculate summary statistics
    const totalCustomers = queueHistory.reduce((sum, day) => sum + (day.totalCustomers || 0), 0);
    const avgWaitTime = queueHistory.length > 0 
      ? queueHistory.reduce((sum, day) => sum + (day.avgWaitTime || 0), 0) / queueHistory.length
      : 0;
    const totalResets = resetLogs.rows.filter(log => log.success).length;
    const failedResets = resetLogs.rows.filter(log => !log.success).length;
    
    res.json({
      success: true,
      period: {
        days: numDays,
        start_date: new Date(Date.now() - numDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0]
      },
      summary: {
        total_customers_served: totalCustomers,
        average_wait_time_minutes: Math.round(avgWaitTime * 100) / 100,
        successful_resets: totalResets,
        failed_resets: failedResets,
        reset_success_rate: totalResets > 0 ? Math.round((totalResets / (totalResets + failedResets)) * 100) : 0
      },
      daily_queue_history: queueHistory,
      display_monitor_history: monitorHistory,
      reset_logs: resetLogs.rows,
      description: 'Comprehensive historical analytics from daily queue scheduler'
    });
  } catch (error) {
    console.error('Error fetching historical dashboard:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch historical analytics dashboard' 
    });
  }
});

export default router;

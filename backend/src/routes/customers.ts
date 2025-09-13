import express, { Router, Response } from 'express';
import { CustomerService } from '../services/customer';
import { NotificationService } from '../services/notification';
import { ExportService } from '../services/export';
import { DetailedExportService } from '../services/detailedExport';
import { enhancedExportService, ExportOptions } from '../services/enhancedExportService';
import { WebSocketService } from '../services/websocket';
import { UserService } from '../services/user';
const { authenticateToken, requireSalesOrAdmin, requireAdmin, logActivity } = require('../middleware/auth');
import { requireCustomerOwnership, getSalesAgentFilter } from '../middleware/ownership';
import { AuthRequest, QueueStatus } from '../types';
import { pool } from '../config/database';
import { validateSchema } from '../middleware/validation';
import {
  createCustomerSchema,
  updateCustomerSchema,
  updateCustomerStatusSchema,
  notifyCustomerSchema
} from '../validation/schemas/customer';

const router: express.Router = Router();

// Create customer
router.post('/', authenticateToken, requireSalesOrAdmin, validateSchema(createCustomerSchema), logActivity('create_customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    console.log('🌐 [API_DEBUG] Raw request body received from frontend:', JSON.stringify(req.body, null, 2));
    
    const customerData = {
      ...req.body,
      sales_agent_id: req.user!.id,
      create_initial_transaction: req.body.create_initial_transaction !== undefined ? req.body.create_initial_transaction : true
    };
    
    console.log('🌐 [API_DEBUG] Processed customerData being sent to service:', JSON.stringify(customerData, null, 2));
    console.log('🌐 [API_DEBUG] Payment info specifically from API:', JSON.stringify(customerData.payment_info, null, 2));

    const customer = await CustomerService.create(customerData);
    
    // Send customer registration notification to cashiers
    try {
      const salesAgent = await UserService.findById(req.user!.id);
      WebSocketService.emitCustomerRegistrationNotification({
        customer,
        created_by: req.user!.id,
        created_by_name: salesAgent?.full_name || 'Sales Agent',
        location_id: 1 // Default location, can be made dynamic based on user context
      });
      console.log(`[CUSTOMER_REGISTRATION] Notification sent for new customer: ${customer.name} (${customer.or_number})`);
    } catch (notificationError) {
      console.error('Error sending registration notification:', notificationError);
      // Don't fail the customer creation if notification fails
    }
    
    res.status(201).json(customer);
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List customers - Enhanced for cashier access
router.get('/', authenticateToken, logActivity('list_customers'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, salesAgentId, startDate, endDate, searchTerm, sortBy = 'created_at', sortOrder = 'desc', page = '1', limit = '20' } = req.query;
    
    // Apply role-based filtering:
    // - Sales agents: Only see their own customers
    // - Cashiers: See all customers for transaction processing
    // - Admins: See all customers
    let effectiveSalesAgentId: number | undefined;
    
    if (req.user!.role === 'sales') {
      // Sales agents can only see their own customers
      effectiveSalesAgentId = req.user!.id;
    } else if (req.user!.role === 'cashier') {
      // Cashiers can see all customers or filter by specific sales agent
      effectiveSalesAgentId = salesAgentId ? parseInt(salesAgentId as string, 10) : undefined;
    } else if (req.user!.role === 'admin') {
      // Admins can see all customers or filter by specific sales agent
      effectiveSalesAgentId = salesAgentId ? parseInt(salesAgentId as string, 10) : undefined;
    }
    
    // Timezone-aware date parsing for YYYY-MM-DD inputs (Asia/Manila)
    const toManilaBoundary = (dateStr?: string, endOfDay: boolean = false): Date | undefined => {
      if (!dateStr) return undefined;
      // If input already includes time or timezone, trust it as-is
      if (/T|Z|\+\d{2}:?\d{2}/i.test(dateStr)) {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? undefined : d;
      }
      // Interpret plain YYYY-MM-DD as Manila local day boundaries
      const ts = endOfDay ? `${dateStr}T23:59:59+08:00` : `${dateStr}T00:00:00+08:00`;
      const d = new Date(ts);
      return isNaN(d.getTime()) ? undefined : d;
    };

    const filters = {
      status: status as QueueStatus,
      salesAgentId: effectiveSalesAgentId,
      startDate: toManilaBoundary(startDate as string, false),
      endDate: toManilaBoundary(endDate as string, true),
      searchTerm: searchTerm as string
    };

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    const result = await CustomerService.list(filters, limitNum, offset, sortBy as string, sortOrder as 'asc' | 'desc');
    
    res.json({
      customers: result.customers,
      pagination: {
        current_page: pageNum,
        per_page: limitNum,
        total: result.total,
        total_pages: Math.ceil(result.total / limitNum)
      },
      user_context: {
        role: req.user!.role,
        can_create: req.user!.role === 'sales' || req.user!.role === 'admin',
        can_edit: true, // All authenticated users can edit customers
        can_export: true
      }
    });
  } catch (error) {
    console.error('Error listing customers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get customer by ID
router.get('/:id', authenticateToken, requireCustomerOwnership, logActivity('get_customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const customerId = Number(id);
    if (!Number.isInteger(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return;
    }

    const customer = await CustomerService.findById(customerId);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.json(customer);
  } catch (error) {
    console.error('Error getting customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get customer by OR number
router.get('/or/:orNumber', authenticateToken, logActivity('get_customer_by_or'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orNumber } = req.params;
    const customer = await CustomerService.findByOrNumber(orNumber);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.json(customer);
  } catch (error) {
    console.error('Error getting customer by OR number:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update customer - Allow cashiers to update customer info
router.put('/:id', authenticateToken, requireCustomerOwnership, validateSchema(updateCustomerSchema), logActivity('update_customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const customerId = Number(id);
    if (!Number.isInteger(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return;
    }

    const updates = req.body;
    
    const customer = await CustomerService.update(customerId, updates);
    res.json(customer);
  } catch (error) {
    console.error('Error updating customer:', error);
    if (error instanceof Error && error.message === 'Customer not found') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Update customer status
router.patch('/:id/status', authenticateToken, validateSchema(updateCustomerStatusSchema), logActivity('update_customer_status'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const customerId = Number(id);
    if (!Number.isInteger(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return;
    }

    const { status } = req.body;

    if (!Object.values(QueueStatus).includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const customer = await CustomerService.updateStatus(customerId, status);
    res.json(customer);
  } catch (error) {
    console.error('Error updating customer status:', error);
    if (error instanceof Error && error.message === 'Customer not found') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Delete customer
router.delete('/:id', authenticateToken, requireAdmin, logActivity('delete_customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const customerId = Number(id);
    if (!Number.isInteger(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return;
    }

    await CustomerService.delete(customerId);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting customer:', error);
    if (error instanceof Error && error.message === 'Customer not found') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Send notification to customer
router.post('/:id/notify', authenticateToken, requireSalesOrAdmin, requireCustomerOwnership, validateSchema(notifyCustomerSchema), logActivity('notify_customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const customerId = Number(id);
    if (!Number.isInteger(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return;
    }

    const { type, customMessage } = req.body;

    const customer = await CustomerService.findById(customerId);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    try {
      switch (type) {
        case 'ready':
          await NotificationService.sendCustomerReadyNotification(
            customer.id,
            customer.name,
            customer.contact_number
          );
          break;
        case 'delay':
          const estimatedTime = req.body.estimated_time;
          const totalMinutes = estimatedTime ? CustomerService.estimatedTimeToMinutes(estimatedTime) : CustomerService.estimatedTimeToMinutes(customer.estimated_time);
          await NotificationService.sendDelayNotification(
            customer.id,
            customer.name,
            customer.contact_number,
            totalMinutes
          );
          break;
        case 'pickup_reminder':
          await NotificationService.sendPickupReminder(
            customer.id,
            customer.name,
            customer.contact_number
          );
          break;
        case 'custom':
          if (!customMessage) {
            res.status(400).json({ error: 'Custom message is required' });
            return;
          }
          await NotificationService.sendSMS(
            customer.contact_number,
            customMessage,
            customer.id
          );
          break;
        default:
          res.status(400).json({ error: 'Invalid notification type' });
          return;
      }

      res.json({ message: 'Notification sent successfully' });
    } catch (notificationError) {
      console.error('Error sending notification:', notificationError);
      res.status(500).json({ error: 'Failed to send notification' });
    }
  } catch (error) {
    console.error('Error in notify customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get queue statistics
router.get('/stats/queue', authenticateToken, logActivity('get_queue_stats'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stats = await CustomerService.getQueueStatistics();
    res.json(stats);
  } catch (error) {
    console.error('Error getting queue statistics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sales agent statistics
router.get('/stats/sales-agent', authenticateToken, requireSalesOrAdmin, logActivity('get_sales_agent_stats'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const salesAgentId = getSalesAgentFilter(req.user!) || req.user!.id;
    const stats = await CustomerService.getSalesAgentStatistics(salesAgentId);
    res.json(stats);
  } catch (error) {
    console.error('Error getting sales agent statistics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export single customer to Excel with progress tracking
router.get('/:id/export/excel', authenticateToken, logActivity('export_customer_excel'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const customerId = Number(id);
    if (!Number.isInteger(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return;
    }

    const exportOptions: ExportOptions = {
      format: 'xlsx',
      exportType: 'single',
      customerIds: [customerId]
    };

    const { exportId, result } = await enhancedExportService.startExport(exportOptions);
    
    // For single customer exports, we can return the result directly since it's fast
    const exportResult = await result;
    
    res.setHeader('Content-Type', exportResult.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
    res.send(exportResult.buffer);
  } catch (error) {
    console.error('Error exporting customer to Excel:', error);
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: 'Customer not found' });
    } else {
      res.status(500).json({ error: 'Failed to export customer data' });
    }
  }
});

// Export single customer to PDF with progress tracking  
router.get('/:id/export/pdf', authenticateToken, logActivity('export_customer_pdf'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const customerId = Number(id);
    if (!Number.isInteger(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return;
    }

    const exportOptions: ExportOptions = {
      format: 'pdf',
      exportType: 'single',
      customerIds: [customerId]
    };

    const { exportId, result } = await enhancedExportService.startExport(exportOptions);
    
    // For single customer exports, we can return the result directly since it's fast
    const exportResult = await result;
    
    res.setHeader('Content-Type', exportResult.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
    res.send(exportResult.buffer);
  } catch (error) {
    console.error('Error exporting customer to PDF:', error);
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: 'Customer not found' });
    } else {
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  }
});

// Export single customer to Google Sheets
router.post('/:id/export/sheets', authenticateToken, logActivity('export_customer_sheets'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const customerId = Number(id);
    if (!Number.isInteger(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return;
    }

    const result = await ExportService.exportCustomerToGoogleSheets(customerId);
    res.json(result);
  } catch (error) {
    console.error('Error exporting customer to Google Sheets:', error);
    if (error instanceof Error && error.message === 'Customer not found') {
      res.status(404).json({ error: error.message });
    } else if (error instanceof Error && error.message === 'Google Sheets URL not configured') {
      res.status(500).json({ error: 'Google Sheets integration not configured' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Export multiple customers to Excel with async processing and progress tracking
router.post('/export/excel', authenticateToken, logActivity('export_customers_excel'), async (req: AuthRequest, res: Response) => {
  try {
    const { searchTerm, statusFilter, dateFilter, customerIds, async = false } = req.body;
    
    const exportOptions: ExportOptions = {
      format: 'xlsx',
      exportType: customerIds && Array.isArray(customerIds) && customerIds.length > 0 ? 'selected' : 'multiple',
      searchTerm,
      statusFilter,
      dateFilter,
      customerIds
    };

    const { exportId, result } = await enhancedExportService.startExport(exportOptions);
    
    if (async) {
      // Return export ID for async processing with progress tracking
      res.json({
        exportId,
        message: 'Export started. Use the exportId to check progress.',
        progressUrl: `/api/exports/${exportId}/progress`
      });
    } else {
      // Wait for completion and return file directly (for smaller exports)
      const exportResult = await result;
      
      res.setHeader('Content-Type', exportResult.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
      res.send(exportResult.buffer);
    }
  } catch (error) {
    console.error('Error exporting customers to Excel:', error);
    if (error instanceof Error && error.message.includes('No customers found')) {
      res.status(404).json({ error: 'No customers found matching the specified criteria' });
    } else if (error instanceof Error && error.message.includes('Maximum concurrent')) {
      res.status(429).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to export customer data' });
    }
  }
});

// Export multiple customers to PDF
router.post('/export/pdf', authenticateToken, logActivity('export_customers_pdf'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { searchTerm, statusFilter, dateFilter, customerIds } = req.body;
    
    let buffer;
    if (customerIds && Array.isArray(customerIds) && customerIds.length > 0) {
      // Export selected customers
      buffer = await ExportService.exportSelectedCustomersToPDF(customerIds);
    } else {
      // Export with filters (existing functionality)
      buffer = await ExportService.exportCustomersToPDF(searchTerm, statusFilter, dateFilter);
    }
    
    // Set proper headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=customers.pdf');
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting customers to PDF:', error);
    if (error instanceof Error && error.message === 'No customers found to export') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Export multiple customers to Google Sheets
router.post('/export/sheets', authenticateToken, logActivity('export_customers_sheets'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { searchTerm, statusFilter, dateFilter } = req.body;
    const result = await ExportService.exportCustomersToGoogleSheets(searchTerm, statusFilter, dateFilter);
    res.json(result);
  } catch (error) {
    console.error('Error exporting customers to Google Sheets:', error);
    if (error instanceof Error && error.message === 'Google Sheets URL not configured') {
      res.status(500).json({ error: 'Google Sheets integration not configured' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Export multiple customers to detailed PDF (one customer per page)
router.post('/export/detailed-pdf', authenticateToken, logActivity('export_customers_detailed_pdf'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { searchTerm, statusFilter, dateFilter, customerIds } = req.body;
    
    let buffer;
    if (customerIds && Array.isArray(customerIds) && customerIds.length > 0) {
      // Export selected customers with detailed template
      buffer = await DetailedExportService.exportSelectedCustomersToDetailedPDF(customerIds);
    } else {
      // Export with filters (existing functionality)
      buffer = await DetailedExportService.exportCustomersToDetailedPDF(searchTerm, statusFilter, dateFilter);
    }
    
    // Set proper headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="customers-detailed.pdf"');
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting customers to detailed PDF:', error);
    if (error instanceof Error && error.message === 'No customers found to export') {
      res.status(404).json({ error: 'No customers found matching the specified criteria' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Get grade types for dropdown (accessible to sales agents)
router.get('/dropdown/grade-types', authenticateToken, requireSalesOrAdmin, logActivity('list_grade_types'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = 'SELECT * FROM grade_types ORDER BY name ASC';
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listing grade types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get lens types for dropdown (accessible to sales agents)
router.get('/dropdown/lens-types', authenticateToken, requireSalesOrAdmin, logActivity('list_lens_types'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = 'SELECT * FROM lens_types ORDER BY name ASC';
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listing lens types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

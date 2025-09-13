import React, { useState, useEffect } from 'react';
import {
  IconButton,
  Badge,
  Popover,
  Box,
  Typography,
  Button,
  Fade,
  Tooltip
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  NotificationsNone as NotificationsNoneIcon
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { NotificationDropdown } from './NotificationDropdown';
import { CustomerRegistrationNotification, CustomerRegistrationToast } from './CustomerRegistrationToast';

interface NotificationBellProps {
  className?: string;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ className }) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [notifications, setNotifications] = useState<CustomerRegistrationNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<CustomerRegistrationNotification | null>(null);

  // Only show for cashiers
  const isEnabled = user?.role === 'cashier';
  const isOpen = Boolean(anchorEl);

  // WebSocket connection handling
  useEffect(() => {
    if (!socket || !isEnabled) return;

    const handleConnect = () => {
      console.log('[NOTIFICATION_BELL] Connected to WebSocket');
      setIsConnected(true);
      socket.emit('subscribe:customer_registration_notifications');
    };

    const handleDisconnect = () => {
      console.log('[NOTIFICATION_BELL] Disconnected from WebSocket');
      setIsConnected(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket, isEnabled]);

  // Handle new notifications
  useEffect(() => {
    if (!socket || !isEnabled) return;

    const pushNotification = (data: CustomerRegistrationNotification) => {
      setNotifications(prev => {
        const exists = prev.some(n => n.notification_id === data.notification_id);
        if (exists) return prev;
        const updated = [data, ...prev];
        return updated.slice(0, 20);
      });
      setUnreadCount(prev => prev + 1);
    };

    const handleNewNotification = (data: CustomerRegistrationNotification) => {
      console.log('[NOTIFICATION_BELL] New notification received (isolated):', data);
      pushNotification(data);
    };

    // Legacy/alternate event from WebSocketService.emitCustomerRegistrationNotification
    const handleLegacyNotification = (payload: any) => {
      try {
        console.log('[NOTIFICATION_BELL] Legacy notification received:', payload);
        const flags = payload.priority_flags || { senior_citizen: false, pregnant: false, pwd: false };
        const mapped: CustomerRegistrationNotification = {
          notification_id: payload.id || `legacy_${Date.now()}`,
          type: 'customer_registration',
          title: 'New Customer Registration',
          message: payload.message || `New registration: ${payload.customer_name}`,
          customer_data: {
            id: payload.customer_id,
            name: payload.customer_name,
            or_number: payload.or_number,
            token_number: payload.token_number,
            contact_number: payload.metadata?.contact_number,
            priority_type: payload.priority_type || (flags.senior_citizen ? 'Senior Citizen' : flags.pregnant ? 'Pregnant' : flags.pwd ? 'PWD' : 'Regular Customer'),
            priority_flags: flags,
            payment_amount: Number(payload.payment_amount || 0),
            payment_mode: payload.payment_mode || 'cash',
          },
          created_by_name: payload.created_by_name || 'Sales Agent',
          created_by_role: 'sales',
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          actions: [
            { action_type: 'view_customer', label: 'View Details', is_primary: false },
            { action_type: 'start_transaction', label: 'Process Transaction', is_primary: true },
          ],
        };
        pushNotification(mapped);
      } catch (e) {
        console.error('[NOTIFICATION_BELL] Failed to map legacy notification:', e);
      }
    };

    const handleNotificationRead = (data: { notificationId: string }) => {
      console.log('[NOTIFICATION_BELL] Notification marked as read:', data.notificationId);
      setNotifications(prev => 
        prev.filter(n => n.notification_id !== data.notificationId)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    };

    socket.on('new_customer_registration_notification', handleNewNotification);
    socket.on('customer_registration_notification', handleLegacyNotification);
    socket.on('customer_notification_marked_read', handleNotificationRead);

    return () => {
      socket.off('new_customer_registration_notification', handleNewNotification);
      socket.off('customer_registration_notification', handleLegacyNotification);
      socket.off('customer_notification_marked_read', handleNotificationRead);
    };
  }, [socket, isEnabled]);

  // Load existing notifications on mount
  useEffect(() => {
    if (!isEnabled) return;
    
    const loadNotifications = async () => {
      try {
        const { authenticatedApiRequest, parseApiResponse } = await import('../../utils/api');
        const response = await authenticatedApiRequest('/customer-notifications/active', { method: 'GET' });
        const data = await parseApiResponse<{ success: boolean; notifications: CustomerRegistrationNotification[] }>(response);
        if (data.success && Array.isArray(data.notifications)) {
          setNotifications(data.notifications);
          setUnreadCount(data.notifications.length);
          console.log('[NOTIFICATION_BELL] Loaded existing notifications:', data.notifications.length);
          
          // Fallback: if none, show last 10 recent customers as informational items
          if (data.notifications.length === 0) {
            await loadRecentCustomersFallback();
          }
        } else {
          await loadRecentCustomersFallback();
        }
      } catch (error) {
        console.error('[NOTIFICATION_BELL] Error loading notifications:', error);
        await loadRecentCustomersFallback();
      }
    };

    // Fallback loader shared with dashboard: fetch last 10 recent customers
    const loadRecentCustomersFallback = async () => {
      try {
        const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
        // First try today's customers
        const today = new Date().toISOString().split('T')[0];
        const makeReq = async (params: Record<string, string>) => {
          const qs = new URLSearchParams(params).toString();
          const resp = await fetch(`${API_BASE_URL}/customers?${qs}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
          });
          if (!resp.ok) return [] as any[];
          const json = await resp.json();
          return Array.isArray(json.customers) ? json.customers : [];
        };
        
        let list = await makeReq({ startDate: today, endDate: today, page: '1', limit: '10', sortBy: 'created_at', sortOrder: 'desc' });
        if (list.length === 0) {
          // If none today, fetch most recent overall
          list = await makeReq({ page: '1', limit: '10', sortBy: 'created_at', sortOrder: 'desc' });
        }
        
        const mapped: CustomerRegistrationNotification[] = list.map((c: any) => {
          const flags = c.priority_flags || { senior_citizen: false, pregnant: false, pwd: false };
          const priorityType = flags.senior_citizen ? 'Senior Citizen' : flags.pregnant ? 'Pregnant' : flags.pwd ? 'PWD' : 'Regular Customer';
          const pinfo = c.payment_info || {};
          const amount = typeof pinfo.amount === 'number' ? pinfo.amount : Number(String(pinfo.amount || '0').replace(/[^0-9.-]/g, '')) || 0;
          return {
            notification_id: `customer_${c.id}`,
            type: 'customer_registration',
            title: 'New Customer Registration',
            message: `${c.name} (${priorityType}) registered`,
            customer_data: {
              id: c.id,
              name: c.name,
              or_number: c.or_number,
              token_number: c.token_number,
              contact_number: c.contact_number,
              priority_type: priorityType,
              priority_flags: flags,
              payment_amount: amount,
              payment_mode: pinfo.mode || 'cash',
            },
            created_by_name: c.sales_agent_name || 'Sales Agent',
            created_by_role: 'sales',
            expires_at: new Date().toISOString(),
            created_at: c.created_at || new Date().toISOString(),
            actions: [
              { action_type: 'view_customer', label: 'View Details', is_primary: false },
              { action_type: 'start_transaction', label: 'Process Transaction', is_primary: true },
            ],
          } as any;
        });

        if (mapped.length > 0) {
          setNotifications(mapped);
          setUnreadCount(0);
          console.log('[NOTIFICATION_BELL] Loaded fallback recent customers:', mapped.length);
        }
      } catch (e) {
        console.error('[NOTIFICATION_BELL] Fallback loadRecentCustomers failed:', e);
      }
    };

    loadNotifications();
  }, [isEnabled]);

  const handleBellClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleNotificationClick = async (notificationId: string, customerId: number) => {
    // Find the clicked notification
    const notification = notifications.find(n => n.notification_id === notificationId);
    if (!notification) return;

    // Close dropdown
    handleClose();
    
    // Show detailed toast for this notification
    setSelectedNotification(notification);
  };

  // Handle toast action (Process Transaction, View Details)
  const handleToastAction = async (actionType: string, customerId: number, notificationId: string) => {
    console.log('[NOTIFICATION_BELL] Toast action triggered:', actionType, customerId, notificationId);

    // Mark notification as read
    try {
      const { authenticatedApiRequest } = await import('../../utils/api');
      await authenticatedApiRequest(`/customer-notifications/${notificationId}/mark-read`, { method: 'POST' });
    } catch (error) {
      console.error('[NOTIFICATION_BELL] Error marking notification as read:', error);
    }

    // Remove from local state
    setNotifications(prev => 
      prev.filter(n => n.notification_id !== notificationId)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));

    // Close toast
    setSelectedNotification(null);

    // Handle action
    switch (actionType) {
      case 'view_customer':
        // Navigate to customer management page and trigger customer details view
        // Since there's no direct route to individual customer, we'll go to customers page
        // and use URL params to indicate which customer to highlight/view
        window.location.href = `/customers?viewCustomer=${customerId}`;
        break;
      
      case 'start_transaction':
        // Navigate to transactions page with a query parameter to pre-select the customer
        // This allows the transaction management component to auto-populate customer data
        window.location.href = `/transactions?customerId=${customerId}`;
        break;
      
      default:
        console.warn('[NOTIFICATION_BELL] Unknown action type:', actionType);
    }
  };

  // Handle toast dismissal
  const handleToastDismiss = async (notificationId: string) => {
    console.log('[NOTIFICATION_BELL] Dismissing toast:', notificationId);

    // Mark as read in backend
    try {
      const { authenticatedApiRequest } = await import('../../utils/api');
      await authenticatedApiRequest(`/customer-notifications/${notificationId}/mark-read`, { method: 'POST' });
    } catch (error) {
      console.error('[NOTIFICATION_BELL] Error marking notification as read:', error);
    }

    // Remove from local state
    setNotifications(prev => 
      prev.filter(n => n.notification_id !== notificationId)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));

    // Close toast
    setSelectedNotification(null);
  };

  const handleMarkAllAsRead = async () => {
    try {
      // Mark all notifications as read
      const { authenticatedApiRequest } = await import('../../utils/api');
      const promises = notifications.map(notification =>
        authenticatedApiRequest(`/customer-notifications/${notification.notification_id}/mark-read`, {
          method: 'POST'
        })
      );

      await Promise.all(promises);
      setNotifications([]);
      setUnreadCount(0);
      handleClose();
    } catch (error) {
      console.error('[NOTIFICATION_BELL] Error marking all notifications as read:', error);
    }
  };

  // Don't render if not enabled (not a cashier)
  if (!isEnabled) {
    return null;
  }

  return (
    <>
      <Tooltip title="Customer Notifications" arrow>
        <IconButton
          onClick={handleBellClick}
          className={className}
          sx={{
            color: 'inherit',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.1)'
            }
          }}
        >
          <Badge 
            badgeContent={unreadCount} 
            color="error"
            sx={{
              '& .MuiBadge-badge': {
                fontSize: '0.75rem',
                minWidth: '16px',
                height: '16px'
              }
            }}
          >
            {unreadCount > 0 ? (
              <NotificationsIcon sx={{ fontSize: 24 }} />
            ) : (
              <NotificationsNoneIcon sx={{ fontSize: 24 }} />
            )}
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: {
            width: 380,
            maxHeight: 500,
            mt: 1,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            borderRadius: 2,
            overflow: 'hidden'
          }
        }}
        TransitionComponent={Fade}
        transitionDuration={200}
      >
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Notifications
            </Typography>
            {notifications.length > 0 && (
              <Button
                size="small"
                onClick={handleMarkAllAsRead}
                sx={{ 
                  fontSize: '0.75rem',
                  textTransform: 'none',
                  color: 'primary.main'
                }}
              >
                Mark all as read
              </Button>
            )}
          </Box>
          
          {/* Connection status indicator */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: isConnected ? 'success.main' : 'error.main'
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {isConnected ? 'Connected' : 'Disconnected'}
            </Typography>
          </Box>
        </Box>

        <NotificationDropdown
          notifications={notifications}
          onNotificationClick={handleNotificationClick}
          onClose={handleClose}
        />
      </Popover>

      {/* Detailed toast for selected notification */}
      {selectedNotification && (
        <CustomerRegistrationToast
          key={selectedNotification.notification_id}
          notification={selectedNotification}
          onAction={handleToastAction}
          onDismiss={handleToastDismiss}
          index={0}
        />
      )}
    </>
  );
};

export default NotificationBell;

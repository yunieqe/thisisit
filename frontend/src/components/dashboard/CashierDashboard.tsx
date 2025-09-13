import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Badge,
  IconButton,
  List,
  ListItem,
  Button,
  Chip,
  Alert,
  AlertTitle,
  Divider,
  LinearProgress,
  Tooltip,
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  PersonAdd as PersonAddIcon,
  Payment as PaymentIcon,
  Queue as QueueIcon,
  Analytics as AnalyticsIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { CustomerRegistrationNotification } from '../notifications/CustomerRegistrationToast';

const CashierDashboard: React.FC = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<CustomerRegistrationNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [queueStats, setQueueStats] = useState({
    totalWaiting: 0,
    priorityCustomers: 0,
    averageWaitTime: 0
  });
  const [dailyStats, setDailyStats] = useState({
    transactionsToday: 0,
    totalAmount: 0,
    paidTransactions: 0,
    unpaidTransactions: 0,
    registeredCustomers: 0
  });

  // Cashier-specific quick actions
  const quickActions = [
    {
      title: 'Queue Management',
      description: 'Manage customer queue and serving status',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h2m0 0h2m-2 0v4a2 2 0 002 2h2a2 2 0 002-2v-4m0 0h2a2 2 0 002-2V7a2 2 0 00-2-2h-2m-4 11V9a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2z" />
        </svg>
      ),
      path: '/queue',
      bgColor: 'bg-accent-500',
      hoverColor: 'hover:bg-accent-600',
    },
    {
      title: 'Transaction Reports',
      description: 'View daily sales and financial reports',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      path: '/transactions',
      bgColor: 'bg-secondary-600',
      hoverColor: 'hover:bg-secondary-700',
    },
    {
      title: 'Customer Lookup',
      description: 'View customer details and transaction history',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
        </svg>
      ),
      path: '/customers',
      bgColor: 'bg-primary-500',
      hoverColor: 'hover:bg-primary-600',
    },
  ];

  // Load notifications and stats on mount
  useEffect(() => {
    loadNotifications();
    loadQueueStats();
    loadDailyStats();
  }, []);

  // WebSocket connection handling
  useEffect(() => {
    if (!socket) return;

    const handleConnect = () => {
      console.log('[CASHIER_DASHBOARD] Connected to WebSocket');
      setIsConnected(true);
      socket.emit('subscribe:customer_registration_notifications');
      socket.emit('subscribe:queue_updates');
    };

    const handleDisconnect = () => {
      console.log('[CASHIER_DASHBOARD] Disconnected from WebSocket');
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
  }, [socket]);

  // Handle new notifications
  useEffect(() => {
    if (!socket) return;

    const pushNotification = (data: CustomerRegistrationNotification) => {
      setNotifications(prev => {
        const exists = prev.some(n => n.notification_id === data.notification_id);
        if (exists) return prev;
        const updated = [data, ...prev];
        return updated.slice(0, 10);
      });
      setUnreadCount(prev => prev + 1);
    };

    const handleNewNotification = (data: CustomerRegistrationNotification) => {
      console.log('[CASHIER_DASHBOARD] New notification received (isolated):', data);
      pushNotification(data);
    };

    // Legacy/alternate event mapping
    const handleLegacyNotification = (payload: any) => {
      try {
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
            { action_type: 'start_transaction', label: 'Process Transaction', is_primary: true }
          ]
        } as any;
        pushNotification(mapped);
      } catch (e) {
        console.error('[CASHIER_DASHBOARD] Failed to map legacy notification:', e);
      }
    };

    const handleQueueUpdate = (data: { totalWaiting?: number; priorityCustomers?: number; averageWaitTime?: number }) => {
      setQueueStats(prev => ({
        ...prev,
        ...data
      }));
    };

    socket.on('new_customer_registration_notification', handleNewNotification);
    socket.on('customer_registration_notification', handleLegacyNotification);
    socket.on('queue_stats_update', handleQueueUpdate);

    return () => {
      socket.off('new_customer_registration_notification', handleNewNotification);
      socket.off('customer_registration_notification', handleLegacyNotification);
      socket.off('queue_stats_update', handleQueueUpdate);
    };
  }, [socket]);

  const loadNotifications = async () => {
    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      const response = await fetch(`${API_BASE_URL}/customer-notifications/active`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.notifications)) {
          const items = data.notifications.slice(0, 10);
          setNotifications(items);
          setUnreadCount(items.length);

          // Fallback: when there are no active unread notifications, show today's recent customers
          if (items.length === 0) {
            await loadRecentCustomersFallback();
          }
        } else {
          // Fallback when unexpected payload
          await loadRecentCustomersFallback();
        }
      } else {
        // On non-OK response, try fallback
        await loadRecentCustomersFallback();
      }
    } catch (error) {
      console.error('[CASHIER_DASHBOARD] Error loading notifications:', error);
      // Fallback on error as well
      await loadRecentCustomersFallback();
    }
  };

  // Fallback: pull the most recent customers created today and render them in the list
  const loadRecentCustomersFallback = async () => {
    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
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

      // Try today's customers first
      let list = await makeReq({ startDate: today, endDate: today, page: '1', limit: '10', sortBy: 'created_at', sortOrder: 'desc' });
      // If none, use most recent overall
      if (list.length === 0) {
        list = await makeReq({ page: '1', limit: '10', sortBy: 'created_at', sortOrder: 'desc' });
      }

      const mapped = list.map((c: any) => {
        const flags = c.priority_flags || { senior_citizen: false, pregnant: false, pwd: false };
        const priorityType = flags.senior_citizen ? 'Senior Citizen' : flags.pregnant ? 'Pregnant' : flags.pwd ? 'PWD' : 'Regular Customer';
        const pinfo = c.payment_info || {};
        const amount = typeof pinfo.amount === 'number' ? pinfo.amount : Number(String(pinfo.amount || '0').replace(/[^0-9.-]/g, '')) || 0;
        return {
          notification_id: `customer_${c.id}`,
          type: 'customer_registration',
          title: 'New Customer Registration',
          message: `${c.name} (${priorityType}) registered` ,
          customer_data: {
            id: c.id,
            name: c.name,
            or_number: c.or_number,
            token_number: c.token_number,
            contact_number: c.contact_number,
            priority_type: priorityType,
            priority_flags: flags,
            payment_amount: amount,
            payment_mode: pinfo.mode || 'cash'
          },
          created_by_name: c.sales_agent_name || 'Sales Agent',
          created_by_role: 'sales',
          expires_at: new Date().toISOString(),
          created_at: c.created_at || new Date().toISOString(),
          actions: [
            { action_type: 'view_customer', label: 'View Details', is_primary: false },
            { action_type: 'start_transaction', label: 'Process Transaction', is_primary: true }
          ]
        } as any;
      });

      if (mapped.length > 0) {
        setNotifications(mapped);
        // Fallback items are informational; don't count as unread
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('[CASHIER_DASHBOARD] Fallback loadRecentCustomers failed:', err);
    }
  };

  const loadQueueStats = async () => {
    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      const response = await fetch(`${API_BASE_URL}/queue/stats`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setQueueStats(data);
      }
    } catch (error) {
      console.error('[CASHIER_DASHBOARD] Error loading queue stats:', error);
    }
  };

  const loadDailyStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      const response = await fetch(`${API_BASE_URL}/transactions/reports/daily?date=${today}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        let registered = data.registeredCustomers || 0;
        // Fallback correction: if API returns 0, query customer list count for today
        if (registered === 0) {
          try {
            const qs = new URLSearchParams({ startDate: today, endDate: today, page: '1', limit: '1' }).toString();
            const resp = await fetch(`${API_BASE_URL}/customers?${qs}`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
            });
            if (resp.ok) {
              const json = await resp.json();
              const total = json?.pagination?.total;
              if (typeof total === 'number' && total > 0) registered = total;
            }
          } catch (e) {
            console.warn('[CASHIER_DASHBOARD] Fallback registered count failed:', e);
          }
        }
        setDailyStats({
          transactionsToday: data.totalTransactions || 0,
          totalAmount: data.totalAmount || 0,
          paidTransactions: data.paidTransactions || 0,
          unpaidTransactions: data.unpaidTransactions || 0,
          registeredCustomers: registered
        });
      }
    } catch (error) {
      console.error('[CASHIER_DASHBOARD] Error loading daily stats:', error);
    }
  };

  const handleNotificationAction = async (notificationId: string, customerId: number, actionType: string) => {
    // Guard against invalid parameters
    if (!notificationId || !customerId || isNaN(customerId) || customerId <= 0) {
      console.error('[CASHIER_DASHBOARD] Invalid notification or customer ID:', { notificationId, customerId });
      return;
    }
    
    // Mark notification as read (skip for fallback informational items)
    if (!notificationId.startsWith('customer_')) {
      try {
        const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
        await fetch(`${API_BASE_URL}/customer-notifications/${notificationId}/mark-read`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
          }
        });
      } catch (error) {
        console.error('[CASHIER_DASHBOARD] Error marking notification as read:', error);
      }
    }

    // Remove from local state
    setNotifications(prev => prev.filter(n => n.notification_id !== notificationId));
    setUnreadCount(prev => Math.max(0, prev - 1));

    // Navigate based on action
    switch (actionType) {
      case 'view_customer':
        navigate(`/customers?viewCustomer=${customerId}`);
        break;
      case 'start_transaction':
        navigate(`/transactions?customerId=${customerId}`);
        break;
      default:
        console.warn('[CASHIER_DASHBOARD] Unknown action type:', actionType);
    }
  };

  const formatTimeAgo = (timestamp: string): string => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now.getTime() - time.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Cashier Dashboard</h1>
        <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
          Welcome back, <span className="font-semibold">{user?.full_name}</span>!
        </p>
        
        {/* Connection status */}
        <div className="mt-3 flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {isConnected ? 'Real-time updates connected' : 'Connection lost'}
          </span>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white dark:bg-gray-800 shadow-soft">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <Typography variant="h4" className="font-bold text-primary-600 dark:text-primary-400">
                  {queueStats.totalWaiting}
                </Typography>
                <Typography variant="body2" color="textSecondary" className="text-xs">
                  Customers in Queue
                </Typography>
              </div>
              <QueueIcon className="text-primary-500" sx={{ fontSize: 32 }} />
            </div>
            {queueStats.priorityCustomers > 0 && (
              <Chip 
                size="small" 
                label={`${queueStats.priorityCustomers} Priority`}
                color="warning"
                className="mt-2 text-xs"
              />
            )}
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-800 shadow-soft">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <Typography variant="h4" className="font-bold text-accent-600 dark:text-accent-400">
                  {dailyStats.transactionsToday}
                </Typography>
                <Typography variant="body2" color="textSecondary" className="text-xs">
                  Transactions Today
                </Typography>
              </div>
              <AnalyticsIcon className="text-accent-500" sx={{ fontSize: 32 }} />
            </div>
            <Typography variant="caption" color="textSecondary" className="mt-1 text-xs">
              ₱{dailyStats.totalAmount.toLocaleString()} total
            </Typography>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-800 shadow-soft">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <Typography variant="h4" className="font-bold text-green-600 dark:text-green-400">
                  {dailyStats.paidTransactions}
                </Typography>
                <Typography variant="body2" color="textSecondary" className="text-xs">
                  Paid Transactions
                </Typography>
              </div>
              <CheckCircleIcon className="text-green-500" sx={{ fontSize: 32 }} />
            </div>
            <Typography variant="caption" color="textSecondary" className="mt-1 text-xs">
              Completed today
            </Typography>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-800 shadow-soft">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <Typography variant="h4" className="font-bold text-orange-600 dark:text-orange-400">
                  {dailyStats.unpaidTransactions}
                </Typography>
                <Typography variant="body2" color="textSecondary" className="text-xs">
                  Unpaid Transactions Today
                </Typography>
              </div>
              <WarningIcon className="text-orange-500" sx={{ fontSize: 32 }} />
            </div>
            {dailyStats.unpaidTransactions > 0 && (
              <Chip 
                size="small" 
                label="Needs Payment" 
                color="warning"
                className="mt-1 text-xs"
              />
            )}
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-800 shadow-soft">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <Typography variant="h4" className="font-bold text-blue-600 dark:text-blue-400">
                  {dailyStats.registeredCustomers}
                </Typography>
                <Typography variant="body2" color="textSecondary" className="text-xs">
                  Registered Customers Today
                </Typography>
              </div>
              <PersonAddIcon className="text-blue-500" sx={{ fontSize: 32 }} />
            </div>
          </CardContent>
        </Card>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Notifications */}
        <div className="lg:col-span-2">
          <Card className="bg-white dark:bg-gray-800 shadow-soft">
            <CardContent>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <NotificationsIcon className="text-primary-500" />
                  <Typography variant="h6" className="font-semibold">
                    Recent Customer Registrations
                  </Typography>
                  {unreadCount > 0 && (
                    <Badge badgeContent={unreadCount} color="error" />
                  )}
                </div>
                <Button
                  size="small"
                  onClick={() => navigate('/customers')}
                  className="text-primary-600 hover:text-primary-700"
                >
                  View All
                </Button>
              </div>

              {notifications.length === 0 ? (
                <Box className="text-center py-8">
                  <PersonAddIcon sx={{ fontSize: 60 }} className="text-gray-300 dark:text-gray-600 mb-2" />
                  <Typography variant="body1" color="textSecondary">
                    No new customer registrations
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    New customer notifications will appear here
                  </Typography>
                </Box>
              ) : (
                <List className="max-h-96 overflow-auto">
                  {notifications.map((notification, index) => {
                    const isPriority = notification.customer_data.priority_flags?.senior_citizen ||
                                     notification.customer_data.priority_flags?.pregnant ||
                                     notification.customer_data.priority_flags?.pwd;
                    
                    return (
                      <React.Fragment key={notification.notification_id}>
                        <ListItem className="px-0">
                          <div className="flex-1">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <Typography variant="body2" className="font-medium">
                                  {notification.customer_data.name}
                                </Typography>
                                <Typography variant="caption" color="textSecondary" className="block">
                                  OR: {notification.customer_data.or_number} • Token: {notification.customer_data.token_number}
                                </Typography>
                                <Typography variant="caption" color="textSecondary" className="block">
                                  ₱{notification.customer_data.payment_amount.toLocaleString()} • {notification.customer_data.payment_mode}
                                </Typography>
                                {isPriority && (
                                  <Chip 
                                    size="small" 
                                    label={notification.customer_data.priority_type}
                                    color="warning"
                                    className="mt-1"
                                  />
                                )}
                              </div>
                              <div className="flex flex-col items-end space-y-1">
                                <Typography variant="caption" color="textSecondary">
                                  {formatTimeAgo(notification.created_at)}
                                </Typography>
                                <div className="flex space-x-1">
                                  <Tooltip title="Start Transaction">
                                    <IconButton
                                      size="small"
                                      onClick={() => handleNotificationAction(
                                        notification.notification_id,
                                        notification.customer_data.id,
                                        'start_transaction'
                                      )}
                                      className="text-primary-600 hover:text-primary-700"
                                    >
                                      <PaymentIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="View Customer">
                                    <IconButton
                                      size="small"
                                      onClick={() => handleNotificationAction(
                                        notification.notification_id,
                                        notification.customer_data.id,
                                        'view_customer'
                                      )}
                                      className="text-secondary-600 hover:text-secondary-700"
                                    >
                                      <PersonAddIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                  </Tooltip>
                                </div>
                              </div>
                            </div>
                          </div>
                        </ListItem>
                        {index < notifications.length - 1 && <Divider />}
                      </React.Fragment>
                    );
                  })}
                </List>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Quick Actions */}
        <div className="lg:col-span-1">
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card className="bg-white dark:bg-gray-800 shadow-soft">
              <CardContent>
                <Typography variant="h6" className="font-semibold mb-4">
                  Quick Actions
                </Typography>
                <div className="space-y-3">
                  {quickActions.map((action) => (
                    <Button
                      key={action.title}
                      fullWidth
                      variant="outlined"
                      onClick={() => navigate(action.path)}
                      className={`justify-start h-auto p-3 ${action.bgColor} ${action.hoverColor} text-white border-none hover:shadow-md transition-all duration-200`}
                      startIcon={action.icon}
                    >
                      <div className="text-left">
                        <div className="font-medium">{action.title}</div>
                        <div className="text-xs opacity-90 mt-1">{action.description}</div>
                      </div>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Queue Status */}
            <Card className="bg-white dark:bg-gray-800 shadow-soft">
              <CardContent>
                <Typography variant="h6" className="font-semibold mb-4">
                  Queue Status
                </Typography>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Average Wait Time</span>
                    <span className="font-medium">{queueStats.averageWaitTime}min</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Priority Customers</span>
                    <Chip 
                      size="small" 
                      label={queueStats.priorityCustomers}
                      color={queueStats.priorityCustomers > 0 ? "warning" : "default"}
                    />
                  </div>

                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Queue Load</span>
                      <span className="text-sm">{Math.min(queueStats.totalWaiting * 10, 100)}%</span>
                    </div>
                    <LinearProgress 
                      variant="determinate" 
                      value={Math.min(queueStats.totalWaiting * 10, 100)}
                      className="h-2 rounded-full"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Connection Status */}
            <Alert 
              severity={isConnected ? "success" : "warning"} 
              className="shadow-soft"
              icon={isConnected ? <CheckCircleIcon /> : <WarningIcon />}
            >
              <AlertTitle>
                {isConnected ? 'System Connected' : 'Connection Issue'}
              </AlertTitle>
              {isConnected 
                ? 'Receiving real-time updates'
                : 'Some features may be limited'
              }
            </Alert>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CashierDashboard;

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useLocation } from 'react-router-dom';
import { EstimatedTime } from '../../types';
import { formatEstimatedTime } from '../../utils/formatters';
import { apiGet, apiPost, apiPut, apiDelete } from '../../utils/api';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Stepper,
  Step,
  StepLabel,
  Alert,
  Snackbar,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Menu,
  ListItemIcon,
  ListItemText,
  Pagination,
  TableSortLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  useTheme,
  useMediaQuery,
  Stack
} from '@mui/material';
import {
  Add as AddIcon, 
  Print as PrintIcon,
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  GetApp as ExportIcon,
  Visibility as ViewIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import RegistrationNotification from './RegistrationNotification';

interface CustomerFormData {
  // Basic Information
  or_number: string;
  name: string;
  contact_number: string;
  email: string;
  age: number | '';
  address: string;
  occupation: string;
  
  // Distribution Information
  distribution_info: string;
  
  // Doctor Information
  doctor_assigned: string;
  
  // Prescription Information
  prescription: {
    od: string;
    os: string;
    ou: string;
    pd: string;
    add: string;
  };
  
  // Product Information
  grade_type: string;
  lens_type: string;
  frame_code: string;
  estimated_time: {
    days: number | '';
    hours: number | '';
    minutes: number | '';
  };
  
  // Payment Information
  payment_info: {
    mode: string;
    amount: number | '';
  };
  
  // Additional Information
  remarks: string;
  priority_flags: {
    senior_citizen: boolean;
    pregnant: boolean;
    pwd: boolean;
  };
}

interface Customer {
  id: number;
  or_number: string;
  name: string;
  contact_number: string;
  email: string;
  age: number;
  address: string;
  occupation?: string;
  distribution_info: string;
  doctor_assigned?: string;
  prescription: {
    od: string;
    os: string;
    ou: string;
    pd: string;
    add: string;
  };
  grade_type: string;
  lens_type: string;
  frame_code: string;
  estimated_time: EstimatedTime;
  payment_info: {
    mode: string;
    amount: number;
  };
  remarks?: string;
  priority_flags: {
    senior_citizen: boolean;
    pregnant: boolean;
    pwd: boolean;
  };
  queue_status: string;
  token_number: number;
  created_at: string;
  updated_at: string;
  sales_agent_name?: string;
}

const CustomerManagement: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const { socket } = useSocket();
  const { notify } = useNotification();
  const theme = useTheme();
  // Use multiple methods for aggressive mobile detection
  const isMobileBreakpoint = useMediaQuery(theme.breakpoints.down('lg'));
  const isMobileWidth = useMediaQuery('(max-width: 1200px)');
  const isMobileWindow = typeof window !== 'undefined' && window.innerWidth <= 1200;
  
  // Force mobile view if any condition is true
  const isMobile = isMobileBreakpoint || isMobileWidth || isMobileWindow;
  
  // Separate detection for form layout to prevent horizontal scrolling
  const isFormDesktop = useMediaQuery(theme.breakpoints.up('xl')); // 1536px and above for full desktop form
  
  // Debug log to check mobile detection
  console.log('Customer Management - isMobile:', isMobile, 'window width:', window.innerWidth, 'breakpoint:', isMobileBreakpoint, 'width query:', isMobileWidth, 'window check:', isMobileWindow);
  
  // Check if we're on the /customers/new route to automatically show the form
  const isNewCustomerRoute = location.pathname === '/customers/new';
  const [showForm, setShowForm] = useState(isNewCustomerRoute);
  const [activeStep, setActiveStep] = useState(0);
  
  // Customer table state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  
  const [gradeTypes, setGradeTypes] = useState<string[]>([]);
  const [lensTypes, setLensTypes] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [registeredCustomer, setRegisteredCustomer] = useState<any>(null);
  
  const [formData, setFormData] = useState<CustomerFormData>({
    or_number: '',
    name: '',
    contact_number: '',
    email: '',
    age: '',
    address: '',
    occupation: '',
    distribution_info: '',
    doctor_assigned: '',
    prescription: {
      od: '',
      os: '',
      ou: '',
      pd: '',
      add: ''
    },
    grade_type: '',
    lens_type: '',
    frame_code: '',
    estimated_time: {
      days: '',
      hours: '',
      minutes: ''
    },
    payment_info: {
      mode: '',
      amount: ''
    },
    remarks: '',
    priority_flags: {
      senior_citizen: false,
      pregnant: false,
      pwd: false
    }
  });

  const steps = ['Basic Information', 'Prescription Details', 'Payment & Final Details'];
  const distributionMethods = [
    { value: 'lalamove', label: 'Lalamove' },
    { value: 'lbc', label: 'LBC' },
    { value: 'pickup', label: 'Pick Up' }
  ];
  const paymentModes = ['gcash', 'maya', 'bank_transfer', 'credit_card', 'cash'];

  useEffect(() => {
    fetchCustomers();
    fetchDropdownOptions();
    generateORNumber();
  }, []);
  
  useEffect(() => {
    fetchCustomers();
  }, [currentPage, rowsPerPage, sortBy, sortOrder, searchTerm, statusFilter, dateFilter]);

  const generateORNumber = () => {
    const timestamp = Date.now().toString();
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const orNumber = `OR${timestamp.slice(-6)}${randomSuffix}`;
    setFormData(prev => ({ ...prev, or_number: orNumber }));
  };

  useEffect(() => {
    if (socket) {
      socket.on('customer_registration_notification', (data) => {
        notify(
          `New customer registered: ${data.customer_name} with OR ${data.or_number}.`,
          data.is_priority ? 'warning' : 'info'
        );
      });

      return () => {
        socket.off('customer_registration_notification');
      };
    }
  }, [socket, notify]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: rowsPerPage.toString(),
        sortBy: sortBy,
        sortOrder: sortOrder,
        ...(searchTerm && { searchTerm }),
        ...(statusFilter && { status: statusFilter }),
        ...(dateFilter.start && { startDate: dateFilter.start }),
        ...(dateFilter.end && { endDate: dateFilter.end })
      });
      
      console.log('CustomerManagement: About to call apiGet with endpoint:', `/customers?${params}`);
      const response = await apiGet(`/customers?${params}`);
      console.log('CustomerManagement: Response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
        setTotalCustomers(data.pagination?.total || 0);
      } else {
        console.error('CustomerManagement: Failed response:', response.status, response.statusText);
        setErrorMessage('Failed to fetch customers');
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
      setErrorMessage('Error fetching customers');
    } finally {
      setLoading(false);
    }
  }, [currentPage, rowsPerPage, sortBy, sortOrder, searchTerm, statusFilter, dateFilter]);

  const fetchDropdownOptions = async () => {
    try {
      const [gradeResponse, lensResponse] = await Promise.all([
        apiGet('/customers/dropdown/grade-types'),
        apiGet('/customers/dropdown/lens-types')
      ]);
      
      // Define excluded options
      const excludedGradeTypes = ['Bifocal', 'Reading', 'Single Vision'];
      const excludedLensTypes = ['CR-39', 'High Index', 'Trivex', 'Polycarbonate', 'Blue Light Filter'];
      
      if (gradeResponse.ok) {
        const gradeData = await gradeResponse.json();
        const filteredGradeTypes = gradeData
          .map((item: any) => item.name)
          .filter((name: string) => !excludedGradeTypes.includes(name));
        setGradeTypes(filteredGradeTypes);
      }
      
      if (lensResponse.ok) {
        const lensData = await lensResponse.json();
        const filteredLensTypes = lensData
          .map((item: any) => item.name)
          .filter((name: string) => !excludedLensTypes.includes(name));
        setLensTypes(filteredLensTypes);
      }
    } catch (error) {
      console.error('Error fetching dropdown options:', error);
    }
  };

  const handleInputChange = useCallback((field: string, value: any) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setFormData(prev => {
        const parentObj = prev[parent as keyof typeof prev];
        if (typeof parentObj === 'object' && parentObj !== null && !Array.isArray(parentObj)) {
          return {
            ...prev,
            [parent]: {
              ...parentObj,
              [child]: value
            }
          };
        }
        return prev;
      });
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }
  }, []);

  const validatePrescriptionField = useCallback((value: string) => {
    // Allow letters, numbers and common prescription symbols including +, -, ., /, *, parentheses, and spaces
    const prescriptionRegex = /^[a-zA-Z0-9+\-.*()/\s]*$/;
    return prescriptionRegex.test(value) && value.length <= 50;
  }, []);

  const validateFrameCode = useCallback((value: string) => {
    const frameCodeRegex = /^[a-zA-Z0-9\s\-_]*$/;
    return frameCodeRegex.test(value) && value.length <= 100;
  }, []);

  const handleNext = () => {
    setActiveStep(prev => prev + 1);
  };

  const handleBack = () => {
    setActiveStep(prev => prev - 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Clear any previous error messages
    setErrorMessage('');
    
    console.log('🎯 [FRONTEND_DEBUG] Raw formData before submission:', JSON.stringify(formData, null, 2));
    console.log('🎯 [FRONTEND_DEBUG] Payment info from form:', JSON.stringify(formData.payment_info, null, 2));
    
    try {
      const submissionData = {
        or_number: formData.or_number,
        name: formData.name,
        contact_number: formData.contact_number,
        email: formData.email,
        age: Number(formData.age),
        address: formData.address,
        occupation: formData.occupation,
        distribution_info: formData.distribution_info,
        doctor_assigned: formData.doctor_assigned,
        prescription: formData.prescription,
        grade_type: formData.grade_type,
        lens_type: formData.lens_type,
        frame_code: formData.frame_code,
        estimated_time: {
          days: Number(formData.estimated_time.days) || 0,
          hours: Number(formData.estimated_time.hours) || 0,
          minutes: Number(formData.estimated_time.minutes) || 0
        },
        payment_info: {
          mode: normalizePaymentMode(formData.payment_info.mode),
          amount: Number(formData.payment_info.amount) || 0
        },
        remarks: formData.remarks,
        priority_flags: formData.priority_flags,
        sales_agent_id: user?.id
      };
      
      console.log('🎯 [FRONTEND_DEBUG] Processed submissionData being sent to API:', JSON.stringify(submissionData, null, 2));
      console.log('🎯 [FRONTEND_DEBUG] Payment info being sent:', JSON.stringify(submissionData.payment_info, null, 2));
      console.log('🎯 [FRONTEND_DEBUG] Normalized payment mode:', normalizePaymentMode(formData.payment_info.mode));
      console.log('🎯 [FRONTEND_DEBUG] Amount conversion - raw:', formData.payment_info.amount, 'converted:', Number(formData.payment_info.amount));
      
      const isEditing = editingCustomer !== null;
      
      const response = isEditing 
        ? await apiPut(`/customers/${editingCustomer.id}`, submissionData)
        : await apiPost('/customers', submissionData);
      
      if (response.ok) {
        const result = await response.json();
        if (isEditing) {
          setSuccessMessage(`Customer ${result.name} updated successfully!`);
          setEditingCustomer(null);
        } else {
          setRegisteredCustomer(result);
          setSuccessMessage(`Customer registered successfully! OR Number: ${result.or_number}`);
        }
        setShowForm(false);
        setActiveStep(0);
        // Reset form
        setFormData({
          or_number: '',
          name: '',
          contact_number: '',
          email: '',
          age: '',
          address: '',
          occupation: '',
          distribution_info: '',
          doctor_assigned: '',
          prescription: {
            od: '',
            os: '',
            ou: '',
            pd: '',
            add: ''
          },
          grade_type: '',
          lens_type: '',
          frame_code: '',
          estimated_time: {
            days: '',
            hours: '',
            minutes: ''
          },
          payment_info: {
            mode: '',
            amount: ''
          },
          remarks: '',
          priority_flags: {
            senior_citizen: false,
            pregnant: false,
            pwd: false
          }
        });
        fetchCustomers();
      } else {
        const error = await response.json();
        console.error('Server validation error:', error);
        
        // Handle detailed validation errors
        if (error.details && Array.isArray(error.details)) {
          const fieldErrors = error.details.map((detail: any) => 
            `${detail.field}: ${detail.message}`
          ).join(', ');
          setErrorMessage(`Validation failed - ${fieldErrors}`);
        } else {
          setErrorMessage(error.message || error.error || (isEditing ? 'Error updating customer' : 'Error registering customer'));
        }
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      setErrorMessage('Error submitting form. Please try again.');
    }
  };

  const handlePrintToken = () => {
    if (registeredCustomer) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Customer Token</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; }
                .token { font-size: 24px; font-weight: bold; margin: 20px; }
                .details { margin: 10px; }
                
                @media print {
                  @page { size: 58mm auto; margin: 3mm; }
                  body { width: 58mm; margin: 0; }
                  h2 { font-size: 14px; margin: 4px 0; }
                  .token { font-size: 20px; margin: 8px 0; }
                  .details { font-size: 10px; margin: 2px 0; }
                }
              </style>
            </head>
            <body>
              <h2>Esca Shop Premium Eyewear</h2>
              <div class="token">Token #${registeredCustomer.token_number.toString().padStart(3, '0')}</div>
              <div class="details">OR: ${registeredCustomer.or_number}</div>
              <div class="details">Customer: ${registeredCustomer.name}</div>
              <div class="details">Date: ${new Date().toLocaleDateString()}</div>
              <div class="details">Est. Time: ${typeof registeredCustomer.estimated_time === 'object' ? formatEstimatedTime(registeredCustomer.estimated_time) : registeredCustomer.estimated_time + ' minutes'}</div>
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, customer: Customer) => {
    setAnchorEl(event.currentTarget);
    setSelectedCustomer(customer);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedCustomer(null);
  };

  const handleViewCustomer = () => {
    setShowCustomerDialog(true);
    if (selectedCustomer) {
      setAnchorEl(null);
    }
  };

  const handleExportCustomer = async (customer: Customer) => {
    try {
      const response = await apiGet(`/customers/${customer.id}/export`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `customer-${customer.or_number}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error exporting customer:', error);
      setErrorMessage('Failed to export customer data');
    }
    handleMenuClose();
  };

  const handleEditCustomer = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      or_number: customer.or_number,
      name: customer.name,
      contact_number: customer.contact_number,
      email: customer.email || '',
      age: customer.age,
      address: customer.address,
      occupation: customer.occupation || '',
      distribution_info: customer.distribution_info,
      doctor_assigned: customer.doctor_assigned || '',
      prescription: customer.prescription,
      grade_type: customer.grade_type,
      lens_type: customer.lens_type,
      frame_code: customer.frame_code || '',
      estimated_time: customer.estimated_time,
      payment_info: customer.payment_info,
      remarks: customer.remarks || '',
      priority_flags: customer.priority_flags
    });
    setShowForm(true);
    setActiveStep(0);
    handleMenuClose();
  };

  const handleDeleteCustomer = (customer: Customer) => {
    setCustomerToDelete(customer);
    setShowDeleteDialog(true);
    handleMenuClose();
  };

  const confirmDeleteCustomer = async () => {
    if (!customerToDelete) return;
    
    try {
      const response = await apiDelete(`/customers/${customerToDelete.id}`);
      
      if (response.ok) {
        setSuccessMessage(`Customer ${customerToDelete.name} has been deleted successfully`);
        fetchCustomers();
      } else {
        const error = await response.json();
        setErrorMessage(error.message || 'Failed to delete customer');
      }
    } catch (error) {
      console.error('Error deleting customer:', error);
      setErrorMessage('Failed to delete customer');
    }
    
    setShowDeleteDialog(false);
    setCustomerToDelete(null);
  };

  const handleExportCustomerFormat = async (customer: Customer, format: 'excel' | 'pdf' | 'sheets') => {
    try {
      console.log(`Starting ${format.toUpperCase()} export for customer:`, { id: customer.id, name: customer.name });
      
      if (format === 'sheets') {
        // Export to Google Sheets - simplified request (backend extracts customer ID from URL)
        const response = await apiPost(`/customers/${customer.id}/export/sheets`, {});
        
        if (response.ok) {
          const result = await response.json();
          console.log('Google Sheets export result:', result);
          
          // Check if the response indicates success
          if (result.success === false) {
            throw new Error(`Google Sheets Export Error: ${result.error || 'Unknown error from Google Sheets service'}`);
          }
          
          setSuccessMessage(
            result.spreadsheetUrl 
              ? `Customer data exported to Google Sheets successfully! ${result.message || ''}` 
              : 'Customer data exported to Google Sheets successfully!'
          );
        } else {
          // Try to get detailed error message from response
          let errorMessage = 'Failed to export to Google Sheets';
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } catch (parseError) {
            console.warn('Could not parse error response:', parseError);
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }
      } else {
        // Export to Excel or PDF
        const response = await apiGet(`/customers/${customer.id}/export/${format}`);
        
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `customer-${customer.or_number}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
          a.click();
          window.URL.revokeObjectURL(url);
          setSuccessMessage(`Customer data exported to ${format.toUpperCase()} successfully!`);
        } else {
          // Try to get detailed error message from response
          let errorMessage = `Failed to export to ${format.toUpperCase()}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } catch (parseError) {
            console.warn('Could not parse error response:', parseError);
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }
      }
    } catch (error) {
      console.error(`Error exporting customer to ${format}:`, error);
      const errorMessage = error instanceof Error ? error.message : `Failed to export customer data to ${format.toUpperCase()}`;
      setErrorMessage(errorMessage);
    }
    handleMenuClose();
  };

  const handleBulkExport = async (format: 'excel' | 'pdf' | 'sheets') => {
    try {
      console.log(`Starting bulk ${format.toUpperCase()} export with filters:`, { searchTerm, statusFilter, dateFilter });
      
      const response = await apiPost(`/customers/export/${format}`, {
        searchTerm,
        statusFilter,
        dateFilter
      });
      
      if (response.ok) {
        if (format === 'sheets') {
          const result = await response.json();
          console.log('Bulk Google Sheets export result:', result);
          
          // Check if the response indicates success
          if (result.success === false) {
            throw new Error(`Bulk Google Sheets Export Error: ${result.error || 'Unknown error from Google Sheets service'}`);
          }
          
          setSuccessMessage(
            result.spreadsheetUrl 
              ? `Data exported to Google Sheets successfully! ${result.message || ''}` 
              : 'Data exported to Google Sheets successfully!'
          );
        } else {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `customers-export.${format === 'excel' ? 'xlsx' : 'pdf'}`;
          a.click();
          window.URL.revokeObjectURL(url);
          setSuccessMessage(`Data exported to ${format.toUpperCase()} successfully!`);
        }
      } else {
        // Try to get detailed error message from response
        let errorMessage = `Failed to export data to ${format.toUpperCase()}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (parseError) {
          console.warn('Could not parse bulk export error response:', parseError);
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error exporting customers:', error);
      const errorMessage = error instanceof Error ? error.message : `Failed to export customers data to ${format.toUpperCase()}`;
      setErrorMessage(errorMessage);
    }
  };

  const getStatusColor = useCallback((status: string) => {
    switch (status) {
      case 'waiting': return 'warning';
      case 'serving': return 'info';
      case 'completed': return 'success';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  }, []);

  const getPriorityFlags = useCallback((flags: any) => {
    const priorities = [];
    if (flags.senior_citizen) priorities.push('Senior');
    if (flags.pregnant) priorities.push('Pregnant');
    if (flags.pwd) priorities.push('PWD');
    return priorities;
  }, []);

  const getPaymentModeLabel = useCallback((mode: string) => {
    const labels: { [key: string]: string } = {
      'gcash': 'GCash',
      'maya': 'Maya',
      'bank_transfer': 'Bank Transfer',
      'credit_card': 'Credit Card',
      'cash': 'Cash'
    };
    return labels[mode] || mode;
  }, []);

  // Helper function to ensure payment mode is in correct case
  const normalizePaymentMode = (mode: string): string => {
    const normalizedModes: { [key: string]: string } = {
      'gcash': 'gcash',
      'GCash': 'gcash',
      'maya': 'maya',
      'Maya': 'maya',
      'bank_transfer': 'bank_transfer',
      'Bank Transfer': 'bank_transfer',
      'credit_card': 'credit_card',
      'Credit Card': 'credit_card',
      'cash': 'cash',
      'Cash': 'cash'
    };
    return normalizedModes[mode] || mode.toLowerCase();
  };

  const validateForm = useMemo(() => {
    if (activeStep === 0) {
      return formData.or_number && formData.name && formData.contact_number && formData.address && formData.distribution_info;
    }
    if (activeStep === 1) {
      const hasValidEstimatedTime = (formData.estimated_time.days !== '' && formData.estimated_time.days !== 0) || 
                                   (formData.estimated_time.hours !== '' && formData.estimated_time.hours !== 0) || 
                                   (formData.estimated_time.minutes !== '' && formData.estimated_time.minutes !== 0);
      // OD/OS/OU/PD/ADD are optional; only require product selections and an estimated time
      return formData.grade_type &&
             formData.lens_type && formData.frame_code && hasValidEstimatedTime;
    }
    if (activeStep === 2) {
      const hasValidAmount = formData.payment_info.amount && Number(formData.payment_info.amount) > 0;
      return formData.payment_info.mode && hasValidAmount;
    }
    return true;
  }, [activeStep, formData]);

  const renderMobileCustomerCard = (customer: Customer) => (
    <Card key={customer.id} sx={{ 
      mb: 2, 
      width: '100%', 
      maxWidth: '100%',
      boxSizing: 'border-box',
      overflow: 'hidden' // Prevent any content from overflowing
    }}>
      <CardContent sx={{ 
        p: 2,
        '&:last-child': { pb: 2 }, // Override Material-UI's default padding
        boxSizing: 'border-box'
      }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" component="div" sx={{ 
                fontSize: '1.1rem', 
                fontWeight: 'bold', 
                wordBreak: 'break-word',
                lineHeight: 1.2
              }}>
                {customer.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
                OR: {customer.or_number}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
              <Chip 
                label={customer.queue_status.toUpperCase()}
                color={getStatusColor(customer.queue_status) as any}
                size="small"
                sx={{ fontSize: '0.75rem' }}
              />
              <IconButton
                size="small"
                onClick={(e) => handleMenuOpen(e, customer)}
              >
                <MoreVertIcon />
              </IconButton>
            </Box>
          </Box>
          
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Contact
              </Typography>
              <Typography variant="body1" sx={{ 
                fontSize: '0.875rem', 
                wordBreak: 'break-all',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {customer.contact_number}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Token #
              </Typography>
              <Typography variant="h6" color="primary" sx={{ fontSize: '1.25rem' }}>
                {customer.token_number.toString().padStart(3, '0')}
              </Typography>
            </Box>
          </Box>
          
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Distribution
              </Typography>
              <Typography variant="body1" sx={{ 
                fontSize: '0.875rem', 
                wordBreak: 'break-word',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {customer.distribution_info}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right', flexShrink: 0, maxWidth: '40%' }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Email
              </Typography>
              <Typography variant="body1" sx={{ 
                fontSize: '0.875rem', 
                wordBreak: 'break-all',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {customer.email || 'N/A'}
              </Typography>
            </Box>
          </Box>
          
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Address
              </Typography>
              <Typography variant="body1" sx={{ 
                fontSize: '0.875rem', 
                wordBreak: 'break-word',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical'
              }}>
                {customer.address}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Age
              </Typography>
              <Typography variant="body1" sx={{ fontSize: '0.875rem' }}>
                {customer.age}
              </Typography>
            </Box>
          </Box>
          
          {getPriorityFlags(customer.priority_flags).length > 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', mb: 0.5 }}>
                Priority
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {getPriorityFlags(customer.priority_flags).map((flag) => (
                  <Chip key={flag} label={flag} size="small" color="error" sx={{ fontSize: '0.75rem' }} />
                ))}
              </Box>
            </Box>
          )}
          
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Payment
              </Typography>
              <Typography variant="body1" sx={{ fontSize: '0.875rem', fontWeight: 'bold', color: 'success.main' }}>
                ₱{customer.payment_info.amount.toLocaleString()}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                {getPaymentModeLabel(customer.payment_info.mode)}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Date
              </Typography>
              <Typography variant="body1" sx={{ fontSize: '0.875rem' }}>
                {new Date(customer.created_at).toLocaleDateString()}
              </Typography>
            </Box>
          </Box>
          
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Estimated Time
              </Typography>
              <Typography variant="body1" sx={{ fontSize: '0.875rem', fontWeight: 'medium' }}>
                {formatEstimatedTime(customer.estimated_time)}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Grade/Lens
              </Typography>
              <Typography variant="body1" sx={{ 
                fontSize: '0.875rem', 
                wordBreak: 'break-word',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {customer.grade_type}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ 
                fontSize: '0.75rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {customer.lens_type}
              </Typography>
            </Box>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );

  return (
    <Box sx={{ 
        p: { xs: 1, sm: 2, md: 3 }, 
        maxWidth: '100vw',
        width: '100%',
        mx: 'auto',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}>
      <Typography 
        variant="h4" 
        gutterBottom
        sx={{ 
          fontSize: { xs: '1.5rem', sm: '2.125rem' },
          fontWeight: 400,
          lineHeight: 1.235
        }}
      >
        Customer Management
      </Typography>
      
      {/* Only show Add Customer button for admin and sales users */}
      {(user?.role === 'admin' || user?.role === 'sales') && (
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            if (!showForm) {
              generateORNumber();
              setEditingCustomer(null);
            } else {
              setEditingCustomer(null);
            }
            setShowForm(!showForm);
          }}
          sx={{ mb: 3 }}
        >
          {showForm ? 'Cancel' : 'Add New Customer'}
        </Button>
      )}

      {showForm && (
        <Card sx={{ 
          mb: 3, 
          maxWidth: '100%', 
          width: '100%', 
          overflow: 'hidden', 
          boxSizing: 'border-box' 
        }}>
          <CardContent sx={{ 
            p: { xs: 2, sm: 3, md: 4 }, 
            maxWidth: '100%', 
            width: '100%', 
            overflow: 'hidden', 
            boxSizing: 'border-box' 
          }}>
            <Typography variant="h6" gutterBottom>
              {editingCustomer ? `Edit Customer: ${editingCustomer.name}` : 'Add New Customer'}
            </Typography>
            <form onSubmit={handleSubmit}>
              <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
                {steps.map((label) => (
                  <Step key={label}>
                    <StepLabel>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>

              {activeStep === 0 && (
                <Grid container spacing={2}>
                  <Grid size={12}>
                    <Box sx={{ display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
                      <TextField
                        label="OR Number"
                        value={formData.or_number}
                        onChange={(e) => handleInputChange('or_number', e.target.value)}
                        fullWidth
                        required
                        helperText="Official Receipt Number"
                      />
                      <Button 
                        variant="outlined" 
                        onClick={generateORNumber}
                        sx={{ 
                          minWidth: 'auto', 
                          px: 2,
                          width: { xs: '100%', sm: 'auto' }
                        }}
                      >
                        Generate
                      </Button>
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, lg: 6 }}>
                    <TextField
                      label="Full Name"
                      value={formData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      fullWidth
                      required
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, lg: 6 }}>
                    <TextField
                      label="Contact Number"
                      value={formData.contact_number}
                      onChange={(e) => handleInputChange('contact_number', e.target.value)}
                      fullWidth
                      required
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, lg: 6 }}>
                    <TextField
                      label="Email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, lg: 6 }}>
                    <TextField
                      label="Age"
                      value={formData.age}
                      onChange={(e) => handleInputChange('age', e.target.value)}
                      fullWidth
                      type="number"
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, lg: 6 }}>
                    <TextField
                      label="Address"
                      value={formData.address}
                      onChange={(e) => handleInputChange('address', e.target.value)}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, lg: 6 }}>
                    <TextField
                      label="Occupation"
                      value={formData.occupation}
                      onChange={(e) => handleInputChange('occupation', e.target.value)}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={12}>
                    <FormControl fullWidth required>
                      <InputLabel>Distribution Method</InputLabel>
                      <Select
                        value={formData.distribution_info}
                        onChange={(e) => handleInputChange('distribution_info', e.target.value)}
                      >
                        {distributionMethods.map((method) => (
                          <MenuItem key={method.value} value={method.value}>{method.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={12}>
                    <TextField
                      label="Doctor Assigned"
                      value={formData.doctor_assigned}
                      onChange={(e) => handleInputChange('doctor_assigned', e.target.value)}
                      fullWidth
                      helperText="Name of the doctor who assigned this prescription"
                    />
                  </Grid>
                  <Grid size={12}>
                    <Typography variant="subtitle1" gutterBottom>
                      Priority Flags (Check all that apply)
                    </Typography>
                    <FormGroup row={!isMobile}>
                      <FormControlLabel
                        control={<Checkbox checked={formData.priority_flags.senior_citizen} onChange={(e) => handleInputChange('priority_flags.senior_citizen', e.target.checked)} />}
                        label="Senior Citizen"
                      />
                      <FormControlLabel
                        control={<Checkbox checked={formData.priority_flags.pregnant} onChange={(e) => handleInputChange('priority_flags.pregnant', e.target.checked)} />}
                        label="Pregnant"
                      />
                      <FormControlLabel
                        control={<Checkbox checked={formData.priority_flags.pwd} onChange={(e) => handleInputChange('priority_flags.pwd', e.target.checked)} />}
                        label="Person with Disability (PWD)"
                      />
                    </FormGroup>
                  </Grid>
                </Grid>
              )}

              {activeStep === 1 && (
                <Grid container spacing={2}>
                  <Grid size={12}>
                    <Typography variant="h6" gutterBottom>
                      Prescription Details
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField
                      label="OD (Right Eye)"
                      value={formData.prescription.od}
                      onChange={(e) => handleInputChange('prescription.od', e.target.value)}
                      fullWidth
                      error={!!formData.prescription.od && !validatePrescriptionField(formData.prescription.od)}
                      helperText="Max 50 characters. Allowed: letters, numbers, +, -, ., /, *, (, )"
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField
                      label="OS (Left Eye)"
                      value={formData.prescription.os}
                      onChange={(e) => handleInputChange('prescription.os', e.target.value)}
                      fullWidth
                      error={!!formData.prescription.os && !validatePrescriptionField(formData.prescription.os)}
                      helperText="Max 50 characters. Allowed: letters, numbers, +, -, ., /, *, (, )"
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField
                      label="OU (Both Eyes)"
                      value={formData.prescription.ou}
                      onChange={(e) => handleInputChange('prescription.ou', e.target.value)}
                      fullWidth
                      error={!!formData.prescription.ou && !validatePrescriptionField(formData.prescription.ou)}
                      helperText="Max 50 characters. Allowed: letters, numbers, +, -, ., /, *, (, )"
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      label="PD (Pupillary Distance)"
                      value={formData.prescription.pd}
                      onChange={(e) => handleInputChange('prescription.pd', e.target.value)}
                      fullWidth
                      error={!!formData.prescription.pd && !validatePrescriptionField(formData.prescription.pd)}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      label="ADD (Addition)"
                      value={formData.prescription.add}
                      onChange={(e) => handleInputChange('prescription.add', e.target.value)}
                      fullWidth
                      error={!!formData.prescription.add && !validatePrescriptionField(formData.prescription.add)}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <FormControl fullWidth required>
                      <InputLabel>Grade Type</InputLabel>
                      <Select
                        value={formData.grade_type}
                        onChange={(e) => handleInputChange('grade_type', e.target.value)}
                      >
                        {gradeTypes.map((type) => (
                          <MenuItem key={type} value={type}>{type}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <FormControl fullWidth required>
                      <InputLabel>Lens Type</InputLabel>
                      <Select
                        value={formData.lens_type}
                        onChange={(e) => handleInputChange('lens_type', e.target.value)}
                      >
                        {lensTypes.map((type) => (
                          <MenuItem key={type} value={type}>{type}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      label="Frame Code"
                      value={formData.frame_code}
                      onChange={(e) => handleInputChange('frame_code', e.target.value)}
                      fullWidth
                      required
                      error={!!formData.frame_code && !validateFrameCode(formData.frame_code)}
                      helperText="Max 100 characters. Alphanumeric and special characters allowed"
                    />
                  </Grid>
                  <Grid size={12}>
                    <Typography variant="subtitle2" gutterBottom>
                      Estimated Time *
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, md: 4 }}>
                        <TextField
                          label="Days"
                          value={formData.estimated_time.days}
                          onChange={(e) => handleInputChange('estimated_time.days', e.target.value)}
                          fullWidth
                          type="number"
                          inputProps={{ min: 0 }}
                          helperText="Number of days"
                        />
                      </Grid>
                      <Grid size={{ xs: 12, md: 4 }}>
                        <TextField
                          label="Hours"
                          value={formData.estimated_time.hours}
                          onChange={(e) => handleInputChange('estimated_time.hours', e.target.value)}
                          fullWidth
                          type="number"
                          inputProps={{ min: 0, max: 23 }}
                          helperText="Number of hours (0-23)"
                        />
                      </Grid>
                      <Grid size={{ xs: 12, md: 4 }}>
                        <TextField
                          label="Minutes"
                          value={formData.estimated_time.minutes}
                          onChange={(e) => handleInputChange('estimated_time.minutes', e.target.value)}
                          fullWidth
                          type="number"
                          inputProps={{ min: 0, max: 59 }}
                          helperText="Number of minutes (0-59)"
                        />
                      </Grid>
                    </Grid>
                  </Grid>
                </Grid>
              )}

              {activeStep === 2 && (
                <Grid container spacing={2}>
                  <Grid size={12}>
                    <Typography variant="h6" gutterBottom>
                      Payment & Final Details
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <FormControl fullWidth required>
                      <InputLabel>Payment Mode</InputLabel>
                      <Select
                        value={formData.payment_info.mode}
                        onChange={(e) => handleInputChange('payment_info.mode', e.target.value)}
                      >
                        {paymentModes.map((mode) => (
                          <MenuItem key={mode} value={mode}>{getPaymentModeLabel(mode)}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      label="Payment Amount (₱)"
                      value={formData.payment_info.amount}
                      onChange={(e) => handleInputChange('payment_info.amount', e.target.value)}
                      fullWidth
                      type="number"
                      required
                      inputProps={{ min: 1, step: 0.01 }}
                      helperText="Amount must be greater than 0"
                      error={formData.payment_info.amount !== '' && Number(formData.payment_info.amount) <= 0}
                    />
                  </Grid>
                  <Grid size={12}>
                    <TextField
                      label="Remarks"
                      value={formData.remarks}
                      onChange={(e) => handleInputChange('remarks', e.target.value)}
                      fullWidth
                      multiline
                      rows={4}
                      inputProps={{ maxLength: 500 }}
                      helperText={`${formData.remarks.length}/500 characters`}
                    />
                  </Grid>
                </Grid>
              )}

              <Box sx={{ display: 'flex', flexDirection: 'row', pt: 2 }}>
                <Button
                  color="inherit"
                  disabled={activeStep === 0}
                  onClick={handleBack}
                  sx={{ mr: 1 }}
                >
                  Back
                </Button>
                <Box sx={{ flex: '1 1 auto' }} />
                {activeStep !== steps.length - 1 ? (
                  <Button
                    onClick={handleNext}
                    disabled={!validateForm}
                    variant="contained"
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    disabled={!validateForm}
                  >
                    {editingCustomer ? 'Update Customer' : 'Register Customer'}
                  </Button>
                )}
              </Box>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Success/Error Messages using RegistrationNotification */}
      <RegistrationNotification
        open={Boolean(successMessage)}
        onClose={() => setSuccessMessage('')}
        message={successMessage}
        severity="success"
      />
      
      <RegistrationNotification
        open={Boolean(errorMessage)}
        onClose={() => setErrorMessage('')}
        message={errorMessage}
        severity="error"
      />

      {/* Registered Customer Token */}
      {registeredCustomer && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Customer Successfully Registered!
            </Typography>
            <Typography variant="body1">OR Number: {registeredCustomer.or_number}</Typography>
            <Typography variant="body1">Customer Name: {registeredCustomer.name}</Typography>
            <Typography variant="body1">Token Number: #{registeredCustomer.token_number.toString().padStart(3, '0')}</Typography>
            <Typography variant="body1">Estimated Time: {typeof registeredCustomer.estimated_time === 'object' ? formatEstimatedTime(registeredCustomer.estimated_time) : `${registeredCustomer.estimated_time} minutes`}</Typography>
            <Button
              onClick={handlePrintToken}
              startIcon={<PrintIcon />}
              variant="contained"
              sx={{ mt: 2 }}
            >
              Print Token
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Registered Customers Table */}
      <Card sx={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
        <CardContent sx={{ p: { xs: 1, sm: 2, md: 3 }, width: '100%', boxSizing: 'border-box' }}>
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: isMobile ? 'flex-start' : 'center', 
            mb: 2,
            flexDirection: isMobile ? 'column' : 'row',
            gap: isMobile ? 2 : 0,
            width: '100%',
            overflow: 'hidden'
          }}>
            <Typography variant="h6">
              {user?.role === 'sales' ? 'My Customers' : 'Registered Customers'}
            </Typography>
            <Box sx={{ 
              display: 'flex', 
              gap: 1,
              flexWrap: 'wrap',
              width: isMobile ? '100%' : 'auto',
              justifyContent: isMobile ? 'flex-start' : 'flex-end'
            }}>
              <Button 
                variant="outlined" 
                startIcon={<ExportIcon />}
                onClick={() => handleBulkExport('excel')}
                size="small"
                sx={{ 
                  minWidth: 'auto',
                  fontSize: '0.75rem',
                  px: 1
                }}
              >
                {isMobile ? 'Excel' : 'Export Excel'}
              </Button>
              <Button 
                variant="outlined" 
                startIcon={<ExportIcon />}
                onClick={() => handleBulkExport('pdf')}
                size="small"
                sx={{ 
                  minWidth: 'auto',
                  fontSize: '0.75rem',
                  px: 1
                }}
              >
                {isMobile ? 'PDF' : 'Export PDF'}
              </Button>
              <Button 
                variant="outlined" 
                startIcon={<ExportIcon />}
                onClick={() => handleBulkExport('sheets')}
                size="small"
                sx={{ 
                  minWidth: 'auto',
                  fontSize: '0.75rem',
                  px: 1
                }}
              >
                {isMobile ? 'Sheets' : 'Export to Sheets'}
              </Button>
              <Button 
                variant="outlined" 
                startIcon={<RefreshIcon />}
                onClick={fetchCustomers}
                size="small"
                sx={{ 
                  minWidth: 'auto',
                  fontSize: '0.75rem',
                  px: 1
                }}
              >
                Refresh
              </Button>
            </Box>
          </Box>
          
          {/* Search and Filters */}
          <Box sx={{ mb: 2, width: '100%', overflow: 'hidden' }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  label="Search customers"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  fullWidth
                  size="small"
                  sx={{ minWidth: 0 }}
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <FormControl fullWidth size="small" sx={{ minWidth: 0 }}>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    label="Status"
                  >
                    <MenuItem value="">All</MenuItem>
                    <MenuItem value="waiting">Waiting</MenuItem>
                    <MenuItem value="serving">Serving</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                    <MenuItem value="cancelled">Cancelled</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <TextField
                  label="Start Date"
                  type="date"
                  value={dateFilter.start}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, start: e.target.value }))}
                  fullWidth
                  size="small"
                  sx={{ minWidth: 0 }}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <TextField
                  label="End Date"
                  type="date"
                  value={dateFilter.end}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, end: e.target.value }))}
                  fullWidth
                  size="small"
                  sx={{ minWidth: 0 }}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </Grid>
          </Box>
          
          {/* Helper text for table navigation */}
          {!isMobile && (
            <Box sx={{ mb: 1, color: 'text.secondary', fontSize: '0.875rem' }}>
              <Typography variant="body2">
                💡 Tip: This table has many columns and is horizontally scrollable. Use the horizontal scrollbar at the bottom of the table or scroll horizontally with your mouse/trackpad to see all customer data. 
                The OR Number, Name, and Actions columns remain fixed during scrolling.
              </Typography>
            </Box>
          )}
          
          {/* Customers Table */}
          {isMobile ? (
            // Mobile view - Cards
            <Box sx={{ 
              width: '100%', 
              maxWidth: '100%',
              overflow: 'hidden',
              boxSizing: 'border-box'
            }}>
              {loading ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography>Loading customers...</Typography>
                </Box>
              ) : customers.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography>No customers found</Typography>
                </Box>
              ) : (
                customers.map(renderMobileCustomerCard)
              )}
            </Box>
          ) : (
            // Desktop view - Table
            <Box sx={{ 
              width: '100%', 
              maxWidth: '100%', // Constrain to viewport width
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              mb: 2,
              backgroundColor: '#fff',
              position: 'relative'
            }}>
          <TableContainer
              component={Paper} 
              elevation={0}
              sx={{ 
                maxHeight: 600,
                overflowX: 'auto', // Allow horizontal scrolling when needed
                overflowY: 'auto',
                width: '100%',
                borderRadius: '8px',
                // Force scroll behavior and enhance interaction
                scrollBehavior: 'smooth',
                WebkitOverflowScrolling: 'touch', // Better touch scrolling on mobile
                // Enhanced scrollbar styles for better visibility and interaction
                scrollbarWidth: 'auto',
                scrollbarColor: '#666 #f1f1f1',
                // Webkit scrollbar styles - Enhanced for better interaction
                '&::-webkit-scrollbar': {
                  height: '14px', // Larger for easier interaction
                  width: '14px',
                  backgroundColor: 'transparent'
                },
                '&::-webkit-scrollbar-track': {
                  background: '#f1f1f1',
                  borderRadius: '7px',
                  border: '1px solid #e0e0e0'
                },
                '&::-webkit-scrollbar-thumb': {
                  background: '#666', // Darker for better visibility
                  borderRadius: '7px',
                  border: '2px solid #f1f1f1',
                  '&:hover': {
                    background: '#444' // Even darker on hover
                  },
                  '&:active': {
                    background: '#222' // Darkest when clicked
                  }
                },
                '&::-webkit-scrollbar-corner': {
                  background: '#f1f1f1',
                  border: '1px solid #e0e0e0'
                },
                // Set table to have appropriate width for content
                '& .MuiTable-root': {
                  minWidth: 1200, // Optimized width to minimize horizontal scrolling
                  width: '100%', // Use full available width
                  tableLayout: 'fixed' // Fixed layout for better control over column widths
                },
                '& .MuiTableHead-root': {
                  '& .MuiTableCell-root': {
                    backgroundColor: theme.palette.mode === 'dark' ? '#424242' : '#f5f5f5',
                    fontWeight: 'bold',
                    fontSize: '0.875rem',
                    whiteSpace: 'nowrap'
                  }
                },
                '& .MuiTableBody-root': {
                  '& .MuiTableCell-root': {
                    padding: '8px'
                    // Removed whiteSpace: 'nowrap' to allow proper text overflow handling
                  }
                }
              }}
            >
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: '100px', minWidth: 100, position: 'sticky', left: 0, backgroundColor: 'background.paper', zIndex: 10 }}>
                    <TableSortLabel
                      active={sortBy === 'or_number'}
                      direction={sortBy === 'or_number' ? sortOrder : 'asc'}
                      onClick={() => handleSort('or_number')}
                    >
                      OR Number
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ width: '120px', minWidth: 120, position: 'sticky', left: 100, backgroundColor: 'background.paper', zIndex: 10 }}>
                    <TableSortLabel
                      active={sortBy === 'name'}
                      direction={sortBy === 'name' ? sortOrder : 'asc'}
                      onClick={() => handleSort('name')}
                    >
                      Name
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ width: '100px', minWidth: 100 }}>Contact</TableCell>
                  <TableCell sx={{ width: '120px', minWidth: 120 }}>Email</TableCell>
                  <TableCell sx={{ width: '50px', minWidth: 50 }}>Age</TableCell>
                  <TableCell sx={{ width: '120px', minWidth: 120 }}>Address</TableCell>
                  <TableCell sx={{ width: '80px', minWidth: 80 }}>Occupation</TableCell>
                  <TableCell sx={{ width: '80px', minWidth: 80 }}>Distribution</TableCell>
                  <TableCell sx={{ width: '100px', minWidth: 100 }}>Sales Agent</TableCell>
                  <TableCell sx={{ width: '100px', minWidth: 100 }}>Doctor Assigned</TableCell>
                  <TableCell sx={{ width: '80px', minWidth: 80 }}>Grade Type</TableCell>
                  <TableCell sx={{ width: '80px', minWidth: 80 }}>Lens Type</TableCell>
                  <TableCell sx={{ width: '80px', minWidth: 80 }}>Frame</TableCell>
                  <TableCell sx={{ width: '90px', minWidth: 90 }}>Payment Method</TableCell>
                  <TableCell sx={{ width: '80px', minWidth: 80 }}>Payment Amount</TableCell>
                  <TableCell sx={{ width: '80px', minWidth: 80 }}>Priority</TableCell>
                  <TableCell sx={{ width: '100px', minWidth: 100 }}>Remarks</TableCell>
                  <TableCell sx={{ width: '80px', minWidth: 80 }}>Status</TableCell>
                  <TableCell sx={{ width: '80px', minWidth: 80 }}>Wait Time</TableCell>
                  <TableCell sx={{ width: '100px', minWidth: 100 }}>
                    <TableSortLabel
                      active={sortBy === 'created_at'}
                      direction={sortBy === 'created_at' ? sortOrder : 'asc'}
                      onClick={() => handleSort('created_at')}
                    >
                      Registration Date
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ width: '80px', minWidth: 80, position: 'sticky', right: 0, backgroundColor: 'background.paper', zIndex: 10 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={21} align="center">
                      <Typography>Loading customers...</Typography>
                    </TableCell>
                  </TableRow>
                ) : customers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={21} align="center">
                      <Typography>No customers found</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  customers.map((customer) => (
                    <TableRow key={customer.id} hover>
                      <TableCell sx={{ position: 'sticky', left: 0, backgroundColor: 'background.paper', zIndex: 9 }}>
                        {customer.or_number}
                      </TableCell>
                      <TableCell sx={{ position: 'sticky', left: 100, backgroundColor: 'background.paper', zIndex: 9 }}>
                        <Box sx={{ fontWeight: 'medium' }}>{customer.name}</Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {customer.contact_number}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {customer.email || 'N/A'}
                        </Box>
                      </TableCell>
                      <TableCell>{customer.age}</TableCell>
                      <TableCell>
                        <Box sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {customer.address}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {customer.occupation || 'N/A'}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip label={customer.distribution_info} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {customer.sales_agent_name || 'N/A'}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {customer.doctor_assigned || 'N/A'}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip label={customer.grade_type} size="small" variant="outlined" color="primary" />
                      </TableCell>
                      <TableCell>
                        <Chip label={customer.lens_type} size="small" variant="outlined" color="primary" />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {customer.frame_code || 'N/A'}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip label={getPaymentModeLabel(customer.payment_info.mode)} size="small" variant="outlined" color="info" />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ fontWeight: 'medium', color: 'success.main' }}>
                          ₱{customer.payment_info.amount}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {getPriorityFlags(customer.priority_flags).map((flag, index) => (
                            <Chip 
                              key={index} 
                              label={flag} 
                              color="secondary" 
                              size="small"
                            />
                          ))}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {customer.remarks || 'N/A'}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={customer.queue_status} 
                          color={getStatusColor(customer.queue_status) as any}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ fontWeight: 'medium' }}>
                          {formatEstimatedTime(customer.estimated_time)}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ whiteSpace: 'nowrap' }}>
                          {new Date(customer.created_at).toLocaleDateString()}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ position: 'sticky', right: 0, backgroundColor: 'background.paper', zIndex: 9 }}>
                        <IconButton 
                          size="small" 
                          onClick={(e) => handleMenuOpen(e, customer)}
                        >
                          <MoreVertIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          
          {/* Visual indicator for horizontal scrolling */}
          {!isMobile && (
            <Box sx={{ 
              mt: 1, 
              p: 1, 
              backgroundColor: '#f8f9fa', 
              borderRadius: '4px',
              textAlign: 'center',
              fontSize: '0.75rem',
              color: 'text.secondary',
              border: '1px dashed #dee2e6'
            }}>
              ← Scroll horizontally to see all columns →
            </Box>
          )}
          </Box>
          )}
          
          {/* Pagination */}
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            flexDirection: isMobile ? 'column' : 'row',
            gap: isMobile ? 2 : 0,
            mt: 2,
            width: '100%',
            overflow: 'hidden'
          }}>
            <Typography variant="body2" sx={{ order: isMobile ? 2 : 1 }}>
              Showing {customers.length} of {totalCustomers} customers
            </Typography>
            <Pagination
              count={Math.ceil(totalCustomers / rowsPerPage)}
              page={currentPage}
              onChange={(_, page) => setCurrentPage(page)}
              color="primary"
              showFirstButton={!isMobile}
              showLastButton={!isMobile}
              size={isMobile ? 'small' : 'medium'}
              sx={{ 
                order: isMobile ? 1 : 2,
                '& .MuiPagination-ul': {
                  flexWrap: 'wrap',
                  justifyContent: 'center'
                }
              }}
            />
          </Box>
        </CardContent>
      </Card>
      
      {/* Customer Actions Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleViewCustomer}>
          <ListItemIcon><ViewIcon /></ListItemIcon>
          <ListItemText>View Details</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => selectedCustomer && handleExportCustomerFormat(selectedCustomer, 'excel')}>
          <ListItemIcon><ExportIcon /></ListItemIcon>
          <ListItemText>Export to Excel</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => selectedCustomer && handleExportCustomerFormat(selectedCustomer, 'pdf')}>
          <ListItemIcon><ExportIcon /></ListItemIcon>
          <ListItemText>Export to PDF</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => selectedCustomer && handleExportCustomerFormat(selectedCustomer, 'sheets')}>
          <ListItemIcon><ExportIcon /></ListItemIcon>
          <ListItemText>Export to Google Sheets</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => selectedCustomer && handleEditCustomer(selectedCustomer)}>
          <ListItemIcon><EditIcon /></ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        {user?.role === 'admin' && (
          <MenuItem onClick={() => selectedCustomer && handleDeleteCustomer(selectedCustomer)}>
            <ListItemIcon><DeleteIcon /></ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        )}
      </Menu>
      
      {/* Customer Details Dialog */}
      <Dialog 
        open={showCustomerDialog} 
        onClose={() => setShowCustomerDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Customer Details</DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          {selectedCustomer && (
            <Box>
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                    Basic Information
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>OR Number:</Typography>
                      <Typography variant="body2">{selectedCustomer.or_number}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Name:</Typography>
                      <Typography variant="body2">{selectedCustomer.name}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Contact:</Typography>
                      <Typography variant="body2">{selectedCustomer.contact_number}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Email:</Typography>
                      <Typography variant="body2">{selectedCustomer.email || 'N/A'}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Age:</Typography>
                      <Typography variant="body2">{selectedCustomer.age}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Address:</Typography>
                      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{selectedCustomer.address}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Occupation:</Typography>
                      <Typography variant="body2">{selectedCustomer.occupation || 'N/A'}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Distribution:</Typography>
                      <Typography variant="body2">{selectedCustomer.distribution_info}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Sales Agent:</Typography>
                      <Typography variant="body2">{selectedCustomer.sales_agent_name || 'N/A'}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Doctor Assigned:</Typography>
                      <Typography variant="body2">{selectedCustomer.doctor_assigned || 'N/A'}</Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                    Prescription Details
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>OD (Right Eye):</Typography>
                      <Typography variant="body2">{selectedCustomer.prescription.od}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>OS (Left Eye):</Typography>
                      <Typography variant="body2">{selectedCustomer.prescription.os}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>OU (Both Eyes):</Typography>
                      <Typography variant="body2">{selectedCustomer.prescription.ou}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>PD (Pupillary Distance):</Typography>
                      <Typography variant="body2">{selectedCustomer.prescription.pd}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>ADD (Addition):</Typography>
                      <Typography variant="body2">{selectedCustomer.prescription.add}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Grade Type:</Typography>
                      <Typography variant="body2">{selectedCustomer.grade_type}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Lens Type:</Typography>
                      <Typography variant="body2">{selectedCustomer.lens_type}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Frame Code:</Typography>
                      <Typography variant="body2">{selectedCustomer.frame_code || 'N/A'}</Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                    Payment & Status
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Payment Mode:</Typography>
                      <Typography variant="body2">{getPaymentModeLabel(selectedCustomer.payment_info.mode)}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Amount:</Typography>
                      <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 'bold' }}>₱{selectedCustomer.payment_info.amount.toLocaleString()}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Status:</Typography>
                      <Chip 
                        label={selectedCustomer.queue_status.toUpperCase()}
                        color={getStatusColor(selectedCustomer.queue_status) as any}
                        size="small"
                      />
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Token Number:</Typography>
                      <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 'bold' }}>#{selectedCustomer.token_number.toString().padStart(3, '0')}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Estimated Time:</Typography>
                      <Typography variant="body2">{formatEstimatedTime(selectedCustomer.estimated_time)}</Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                    Additional Information
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Priority Flags:</Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {getPriorityFlags(selectedCustomer.priority_flags).length > 0 ? (
                          getPriorityFlags(selectedCustomer.priority_flags).map((flag, index) => (
                            <Chip key={index} label={flag} color="error" size="small" />
                          ))
                        ) : (
                          <Typography variant="body2">None</Typography>
                        )}
                      </Box>
                    </Box>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary', mb: 1 }}>Remarks:</Typography>
                      <Typography variant="body2" sx={{ 
                        p: 1, 
                        backgroundColor: 'grey.50', 
                        borderRadius: 1,
                        minHeight: '40px',
                        wordBreak: 'break-word'
                      }}>
                        {selectedCustomer.remarks || 'No remarks provided'}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Created:</Typography>
                      <Typography variant="body2">{new Date(selectedCustomer.created_at).toLocaleString()}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Last Updated:</Typography>
                      <Typography variant="body2">{new Date(selectedCustomer.updated_at).toLocaleString()}</Typography>
                    </Box>
                  </Box>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCustomerDialog(false)}>Close</Button>
          <Button 
            onClick={() => selectedCustomer && handleExportCustomerFormat(selectedCustomer, 'pdf')}
            variant="contained"
            startIcon={<ExportIcon />}
            sx={{ mr: 1 }}
          >
            Export PDF
          </Button>
          <Button 
            onClick={() => selectedCustomer && handleExportCustomerFormat(selectedCustomer, 'excel')}
            variant="outlined"
            startIcon={<ExportIcon />}
          >
            Export Excel
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <Dialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Delete Customer</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete customer <strong>{customerToDelete?.name}</strong>?
          </Typography>
          <Typography color="error" sx={{ mt: 2 }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
          <Button 
            onClick={confirmDeleteCustomer}
            variant="contained"
            color="error"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CustomerManagement;

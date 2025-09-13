import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Box, Stack, TextField, Button, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Tooltip, Typography, Alert } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Save as SaveIcon, Close as CloseIcon } from '@mui/icons-material';
import TransactionApi from '../../services/transactionApi';
import { Transaction, TransactionItem, PaymentStatus } from '../../types';

interface Props {
  open: boolean;
  transaction: Transaction | null;
  onClose: () => void;
  onUpdated?: (updated: Transaction) => void;
}

const numberOrZero = (n: any) => {
  if (typeof n === 'number') return isFinite(n) ? n : 0;
  if (typeof n === 'string') {
    const cleaned = n.replace(/[₱$,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(n);
  return isFinite(parsed) ? parsed : 0;
};

const AddOnsDialog: React.FC<Props> = ({ open, transaction, onClose, onUpdated }) => {
  const [items, setItems] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newItem, setNewItem] = useState<{ item_name: string; description?: string; quantity: string; unit_price: string }>({ item_name: '', description: '', quantity: '1', unit_price: '0' });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ quantity: string; unit_price: string }>({ quantity: '1', unit_price: '0' });

  const isPaid = transaction?.payment_status === PaymentStatus.PAID;

  const loadItems = async () => {
    if (!transaction) return;
    setLoading(true);
    setError(null);
    try {
      const list = await TransactionApi.getTransactionItems(transaction.id);
      setItems(list);
    } catch (e: any) {
      setError(e?.message || 'Failed to load add-ons');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && transaction?.id) {
      loadItems();
    } else {
      setItems([]);
      setNewItem({ item_name: '', description: '', quantity: '1', unit_price: '0' });
      setEditingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id]);

  const itemsTotal = useMemo(() => items.reduce((sum, it) => sum + numberOrZero(it.quantity) * numberOrZero(it.unit_price), 0), [items]);
  const paidAmount = numberOrZero(transaction?.paid_amount || 0);
  const balancePreview = Math.max(itemsTotal - paidAmount, 0);

  const handleAdd = async () => {
    if (!transaction) return;
    const qty = numberOrZero(newItem.quantity);
    const price = numberOrZero(newItem.unit_price);
    if (!newItem.item_name || qty <= 0 || price < 0) {
      setError('Please provide item name, positive quantity and non-negative unit price');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await TransactionApi.addTransactionItem(transaction.id, {
        item_name: newItem.item_name.trim(),
        description: newItem.description?.trim(),
        quantity: qty,
        unit_price: price,
      });
      setItems(result.items);
      if (onUpdated) onUpdated(result.transaction);
      setNewItem({ item_name: '', description: '', quantity: '1', unit_price: '0' });
    } catch (e: any) {
      setError(e?.message || 'Failed to add item');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (it: TransactionItem) => {
    setEditingId(it.id);
    setEditDraft({ quantity: String(it.quantity), unit_price: String(it.unit_price) });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (it: TransactionItem) => {
    if (!transaction) return;
    const qty = numberOrZero(editDraft.quantity);
    const price = numberOrZero(editDraft.unit_price);
    if (qty <= 0 || price < 0) {
      setError('Quantity must be > 0 and Unit price >= 0');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await TransactionApi.updateTransactionItem(transaction.id, it.id, { quantity: qty, unit_price: price });
      // Update local items list
      setItems(prev => prev.map(x => x.id === it.id ? { ...x, quantity: qty, unit_price: price } as TransactionItem : x));
      if (onUpdated) onUpdated(result.transaction);
      setEditingId(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to update item');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (it: TransactionItem) => {
    if (!transaction) return;
    setLoading(true);
    setError(null);
    try {
      const result = await TransactionApi.deleteTransactionItem(transaction.id, it.id);
      setItems(prev => prev.filter(x => x.id !== it.id));
      if (onUpdated) onUpdated(result.transaction);
    } catch (e: any) {
      setError(e?.message || 'Failed to delete item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Add-ons for {transaction?.or_number}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="body2" color="text.secondary">
              Totals are based on line items. Payment settlements remain separate. Fully paid transactions are read-only.
            </Typography>
          </Box>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Unit Price</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map(it => (
                <TableRow key={it.id}>
                  <TableCell>{it.item_name}</TableCell>
                  <TableCell>{it.description || '-'}</TableCell>
                  <TableCell align="right">
                    {editingId === it.id ? (
                      <TextField size="small" type="number" inputProps={{ min: 0, step: 0.01 }} value={editDraft.quantity} onChange={e => setEditDraft(d => ({ ...d, quantity: e.target.value }))} disabled={isPaid || loading} sx={{ width: 100 }} />
                    ) : (
                      it.quantity
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {editingId === it.id ? (
                      <TextField size="small" type="number" inputProps={{ min: 0, step: 0.01 }} value={editDraft.unit_price} onChange={e => setEditDraft(d => ({ ...d, unit_price: e.target.value }))} disabled={isPaid || loading} sx={{ width: 120 }} />
                    ) : (
                      it.unit_price.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })
                    )}
                  </TableCell>
                  <TableCell align="right">{(numberOrZero(it.quantity) * numberOrZero(it.unit_price)).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}</TableCell>
                  <TableCell align="center">
                    {editingId === it.id ? (
                      <Stack direction="row" spacing={1} justifyContent="center">
                        <Tooltip title="Save">
                          <span>
                            <IconButton size="small" onClick={() => saveEdit(it)} disabled={isPaid || loading}><SaveIcon fontSize="small" /></IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Cancel">
                          <IconButton size="small" onClick={cancelEdit}><CloseIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={1} justifyContent="center">
                        <Tooltip title={isPaid ? 'Fully paid - read only' : 'Edit'}>
                          <span>
                            <IconButton size="small" onClick={() => startEdit(it)} disabled={isPaid || loading}><EditIcon fontSize="small" /></IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={isPaid ? 'Fully paid - read only' : 'Delete'}>
                          <span>
                            <IconButton size="small" color="error" onClick={() => handleDelete(it)} disabled={isPaid || loading}><DeleteIcon fontSize="small" /></IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              ))}

              {/* New item row */}
              <TableRow>
                <TableCell>
                  <TextField size="small" placeholder="Item name" value={newItem.item_name} onChange={e => setNewItem(s => ({ ...s, item_name: e.target.value }))} disabled={isPaid || loading} />
                </TableCell>
                <TableCell>
                  <TextField size="small" placeholder="Description" value={newItem.description} onChange={e => setNewItem(s => ({ ...s, description: e.target.value }))} disabled={isPaid || loading} />
                </TableCell>
                <TableCell align="right">
                  <TextField size="small" type="number" inputProps={{ min: 0, step: 0.01 }} value={newItem.quantity} onChange={e => setNewItem(s => ({ ...s, quantity: e.target.value }))} disabled={isPaid || loading} sx={{ width: 100 }} />
                </TableCell>
                <TableCell align="right">
                  <TextField size="small" type="number" inputProps={{ min: 0, step: 0.01 }} value={newItem.unit_price} onChange={e => setNewItem(s => ({ ...s, unit_price: e.target.value }))} disabled={isPaid || loading} sx={{ width: 120 }} />
                </TableCell>
                <TableCell align="right">{(numberOrZero(newItem.quantity) * numberOrZero(newItem.unit_price)).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}</TableCell>
                <TableCell align="center">
                  <Tooltip title={isPaid ? 'Fully paid - read only' : 'Add item'}>
                    <span>
                      <IconButton size="small" color="primary" onClick={handleAdd} disabled={isPaid || loading || !newItem.item_name}>
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 3, mt: 1 }}>
            <Typography variant="body2">Items total: <strong>{itemsTotal.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}</strong></Typography>
            <Typography variant="body2">Paid: <strong>{paidAmount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}</strong></Typography>
            <Typography variant="body2">Balance: <strong>{balancePreview.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}</strong></Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddOnsDialog;


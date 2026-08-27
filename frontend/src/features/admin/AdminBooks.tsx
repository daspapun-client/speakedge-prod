import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, TableFilter, PhoneLink, EmailLink } from './_shared';

interface Order {
  id: string;
  order_number: string;
  buyer_name: string;
  phone: string;
  delivery_type: string;
  status: string;
  amount: number;
  courier_name?: string | null;
  tracking_number?: string | null;
  created_at: string;
}

interface StatusHistoryEntry {
  status: string;
  at: string;
  note?: string | null;
  by?: string | null;
}

interface OrderDetail {
  id: string;
  order_number: string;
  buyer_name: string;
  phone: string;
  alt_phone?: string | null;
  email?: string | null;
  delivery_type: string;
  address_line1?: string | null;
  address_line2?: string | null;
  landmark?: string | null;
  state?: string | null;
  district?: string | null;
  city?: string | null;
  pin_code?: string | null;
  delivery_instructions?: string | null;
  /** Set when a copy ships. A book bundled with a membership is free, so
   *  `book_amount` alone cannot say whether anything is dispatched. */
  product_id?: string | null;
  plan?: string | null;
  book_amount: number;
  delivery_charge: number;
  gst_amount: number;
  amount: number;
  status: string;
  status_history: StatusHistoryEntry[];
  courier_name?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  activation_code?: string | null;
  pickup_otp?: string | null;
  pickup_qr?: string | null;
  internal_notes?: string | null;
  version?: string | null;
  created_at: string;
  dispatched_at?: string | null;
  delivered_at?: string | null;
  payment?: { status: string; amount: number; payment_mode?: string } | null;
}

interface OrderEditForm {
  buyer_name: string;
  phone: string;
  alt_phone: string;
  email: string;
  address_line1: string;
  address_line2: string;
  landmark: string;
  state: string;
  district: string;
  city: string;
  pin_code: string;
  delivery_instructions: string;
  internal_notes: string;
}

// Must match OrderStatus enum *values* in backend/app/db/models.py.
const ORDER_STATUSES = [
  'Draft', 'Payment Pending', 'Payment Success', 'Order Confirmed',
  'Inventory Reserved', 'Ready for Dispatch', 'Packed', 'Shipment Created',
  'Shipped', 'In Transit', 'Out for Delivery', 'Delivered',
  'Ready for Pickup', 'Collected', 'Membership Activation Pending',
  'Completed', 'Cancelled', 'Refunded',
];

// Statuses the admin API accepts via POST /admin/orders/{id}/status.
const ADMIN_STATUS_TRANSITIONS = [
  'Packed', 'Shipment Created', 'Shipped', 'In Transit', 'Out for Delivery',
  'Delivered', 'Membership Activation Pending', 'Completed',
];

const TERMINAL_ORDER_STATUSES = new Set(['Cancelled', 'Refunded', 'Completed']);

const DISPATCHED_ORDER_STATUSES = [
  'Shipped', 'In Transit', 'Out for Delivery', 'Delivered', 'Collected',
  'Membership Activation Pending',
];

function isBuyerLocked(status: string) {
  return TERMINAL_ORDER_STATUSES.has(status) || DISPATCHED_ORDER_STATUSES.includes(status);
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function orderToForm(o: OrderDetail): OrderEditForm {
  return {
    buyer_name: o.buyer_name,
    phone: o.phone,
    alt_phone: o.alt_phone ?? '',
    email: o.email ?? '',
    address_line1: o.address_line1 ?? '',
    address_line2: o.address_line2 ?? '',
    landmark: o.landmark ?? '',
    state: o.state ?? '',
    district: o.district ?? '',
    city: o.city ?? '',
    pin_code: o.pin_code ?? '',
    delivery_instructions: o.delivery_instructions ?? '',
    internal_notes: o.internal_notes ?? '',
  };
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
    </div>
  );
}

function OrderDetailModal({
  orderId,
  onClose,
  onUpdated,
}: {
  orderId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<OrderEditForm | null>(null);
  const [error, setError] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [courier, setCourier] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [refundOnCancel, setRefundOnCancel] = useState(false);

  const { data: order, isLoading, refetch } = useQuery({
    queryKey: ['book-order', orderId],
    queryFn: () => unwrap<OrderDetail>(api.get(`/books/admin/orders/${orderId}`)),
  });

  useEffect(() => {
    if (order) {
      setNextStatus(order.status);
      setCourier(order.courier_name ?? '');
      setTrackingNo(order.tracking_number ?? '');
      setTrackingUrl(order.tracking_url ?? '');
    }
  }, [order]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['book-orders'] });
    qc.invalidateQueries({ queryKey: ['book-order', orderId] });
    onUpdated();
  };

  const saveDetails = useMutation({
    mutationFn: () => {
      if (!form || !order) throw new Error('Nothing to save');
      const payload = isBuyerLocked(order.status)
        ? { internal_notes: form.internal_notes.trim() || null }
        : {
            buyer_name: form.buyer_name.trim(),
            phone: form.phone.trim(),
            alt_phone: form.alt_phone.trim() || null,
            email: form.email.trim() || null,
            address_line1: form.address_line1.trim() || null,
            address_line2: form.address_line2.trim() || null,
            landmark: form.landmark.trim() || null,
            state: form.state.trim() || null,
            district: form.district.trim() || null,
            city: form.city.trim() || null,
            pin_code: form.pin_code.trim() || null,
            delivery_instructions: form.delivery_instructions.trim() || null,
            internal_notes: form.internal_notes.trim() || null,
          };
      return unwrap(api.patch(`/books/admin/orders/${orderId}`, payload));
    },
    onSuccess: () => {
      setError('');
      setEditing(false);
      invalidateAll();
      refetch();
    },
    onError: (e: Error) => setError(e.message),
  });

  const setStatus = useMutation({
    mutationFn: () =>
      unwrap(api.post(`/books/admin/orders/${orderId}/status`, {
        status: nextStatus,
        note: statusNote.trim() || undefined,
      })),
    onSuccess: () => {
      setError('');
      setStatusNote('');
      invalidateAll();
      refetch();
    },
    onError: (e: Error) => setError(e.message),
  });

  const saveTracking = useMutation({
    mutationFn: () =>
      unwrap(api.post(`/books/admin/orders/${orderId}/tracking`, {
        courier_name: courier.trim(),
        tracking_number: trackingNo.trim(),
        tracking_url: trackingUrl.trim() || undefined,
      })),
    onSuccess: () => {
      setError('');
      invalidateAll();
      refetch();
    },
    onError: (e: Error) => setError(e.message),
  });

  const cancel = useMutation({
    mutationFn: () =>
      unwrap(api.post(`/books/admin/orders/${orderId}/cancel`, {
        reason: cancelReason.trim(),
        refund: refundOnCancel,
      })),
    onSuccess: () => {
      setError('');
      setCancelReason('');
      invalidateAll();
      refetch();
    },
    onError: (e: Error) => setError(e.message),
  });

  const startEdit = () => {
    if (order) {
      setForm(orderToForm(order));
      setEditing(true);
    }
  };

  const setField = <K extends keyof OrderEditForm>(key: K, value: OrderEditForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const buyerLocked = order ? isBuyerLocked(order.status) : false;

  const canEdit = order && !TERMINAL_ORDER_STATUSES.has(order.status);

  const canCancel = order
    && !TERMINAL_ORDER_STATUSES.has(order.status)
    && !DISPATCHED_ORDER_STATUSES.includes(order.status);

  if (isLoading || !order) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
        <div className="card w-full max-w-3xl">
          <p className="text-slate-500">{isLoading ? 'Loading order…' : 'Order not found.'}</p>
          <button className="btn-ghost mt-4" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{order.order_number}</h2>
            <p className="text-sm text-slate-500">Placed {fmtDate(order.created_at)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!editing && canEdit && (
              <button className="btn-ghost py-1 text-xs" onClick={startEdit}>Edit details</button>
            )}
            <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="badge bg-brand/10 text-brand">{order.status}</span>
          <span className="badge bg-slate-100 text-slate-600 capitalize">{order.delivery_type}</span>
          {order.version && <span className="badge bg-slate-100 text-slate-600">{order.version}</span>}
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {!editing ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2">
              <DetailRow label="Buyer" value={order.buyer_name} />
              <DetailRow label="Phone" value={<PhoneLink phone={order.phone} />} />
              <DetailRow label="Alt phone" value={<PhoneLink phone={order.alt_phone} />} />
              <DetailRow label="Email" value={<EmailLink email={order.email} />} />
              <DetailRow
                label="Book amount"
                value={
                  order.product_id && !order.book_amount
                    ? 'Included with membership'
                    : rupees(order.book_amount)
                }
              />
              <DetailRow label="Delivery charge" value={rupees(order.delivery_charge)} />
              <DetailRow label="GST" value={rupees(order.gst_amount)} />
              <DetailRow label="Total" value={<span className="font-semibold">{rupees(order.amount)}</span>} />
              {order.payment && (
                <DetailRow label="Payment" value={`${order.payment.status} · ${rupees(order.payment.amount)}`} />
              )}
              {order.activation_code && (
                <DetailRow label="Activation code" value={<span className="font-mono">{order.activation_code}</span>} />
              )}
              {order.delivery_type === 'office' && order.pickup_otp && (
                <DetailRow label="Pickup OTP" value={<span className="font-mono">{order.pickup_otp}</span>} />
              )}
            </section>

            {order.delivery_type === 'home' && (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-slate-700">Delivery address</h3>
                <p className="mt-2 text-sm text-slate-600">
                  {[order.address_line1, order.address_line2, order.landmark, order.city,
                    order.district, order.state, order.pin_code].filter(Boolean).join(', ') || '—'}
                </p>
                {order.delivery_instructions && (
                  <p className="mt-1 text-xs text-slate-500">Instructions: {order.delivery_instructions}</p>
                )}
              </section>
            )}

            {(order.courier_name || order.tracking_number) && (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-slate-700">Tracking</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {order.courier_name} · {order.tracking_number}
                  {order.tracking_url && (
                    <> · <a className="text-brand underline" href={order.tracking_url} target="_blank" rel="noreferrer">Track</a></>
                  )}
                </p>
              </section>
            )}

            {order.internal_notes && (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-slate-700">Internal notes</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{order.internal_notes}</p>
              </section>
            )}

            <section className="mt-6">
              <h3 className="text-sm font-semibold text-slate-700">Status timeline</h3>
              <ol className="mt-3 space-y-2 border-l-2 border-slate-200 pl-4">
                {[...order.status_history].reverse().map((h, i) => (
                  <li key={`${h.at}-${i}`} className="relative text-sm">
                    <span className="absolute -left-[1.35rem] top-1.5 h-2 w-2 rounded-full bg-brand" />
                    <span className="font-medium">{h.status}</span>
                    <span className="ml-2 text-xs text-slate-400">{fmtDate(h.at)}</span>
                    {h.note && <p className="text-xs text-slate-500">{h.note}</p>}
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : (
          form && (
            <section className="mt-6 grid gap-3 sm:grid-cols-2">
              {!buyerLocked && (
                <>
                  <div>
                    <label className="label">Buyer name</label>
                    <input className="input" value={form.buyer_name} onChange={(e) => setField('buyer_name', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Phone</label>
                    <input className="input" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Alt phone</label>
                    <input className="input" value={form.alt_phone} onChange={(e) => setField('alt_phone', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input className="input" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
                  </div>
                </>
              )}
              {!buyerLocked && order.delivery_type === 'home' && (
                <>
                  <div className="sm:col-span-2">
                    <label className="label">Address line 1</label>
                    <input className="input" value={form.address_line1} onChange={(e) => setField('address_line1', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Address line 2</label>
                    <input className="input" value={form.address_line2} onChange={(e) => setField('address_line2', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">City</label>
                    <input className="input" value={form.city} onChange={(e) => setField('city', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">PIN code</label>
                    <input className="input" value={form.pin_code} onChange={(e) => setField('pin_code', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">State</label>
                    <input className="input" value={form.state} onChange={(e) => setField('state', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">District</label>
                    <input className="input" value={form.district} onChange={(e) => setField('district', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Landmark</label>
                    <input className="input" value={form.landmark} onChange={(e) => setField('landmark', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Delivery instructions</label>
                    <input className="input" value={form.delivery_instructions} onChange={(e) => setField('delivery_instructions', e.target.value)} />
                  </div>
                </>
              )}
              {buyerLocked && (
                <p className="text-sm text-slate-500 sm:col-span-2">
                  Buyer and address details cannot be changed after dispatch. You can still update internal notes.
                </p>
              )}
              <div className="sm:col-span-2">
                <label className="label">Internal notes</label>
                <textarea className="input" rows={3} value={form.internal_notes} onChange={(e) => setField('internal_notes', e.target.value)} />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <button className="btn-primary" disabled={saveDetails.isPending} onClick={() => { setError(''); saveDetails.mutate(); }}>
                  {saveDetails.isPending ? 'Saving…' : 'Save changes'}
                </button>
                <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </section>
          )
        )}

        {!editing && !TERMINAL_ORDER_STATUSES.has(order.status) && (
          <section className="mt-8 border-t border-slate-200 pt-6">
            <h3 className="text-sm font-semibold text-slate-700">Update status</h3>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <label className="label">New status</label>
                <select className="input" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                  {ADMIN_STATUS_TRANSITIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-[12rem] flex-1">
                <label className="label">Note (optional)</label>
                <input className="input" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
              </div>
              <button
                className="btn-primary"
                disabled={setStatus.isPending || nextStatus === order.status}
                onClick={() => { setError(''); setStatus.mutate(); }}
              >
                {setStatus.isPending ? 'Updating…' : 'Update status'}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Only fulfilment statuses can be set manually.</p>
          </section>
        )}

        {!editing && order.delivery_type === 'home' && !TERMINAL_ORDER_STATUSES.has(order.status) && (
          <section className="mt-6 border-t border-slate-200 pt-6">
            <h3 className="text-sm font-semibold text-slate-700">Shipment tracking</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Courier</label>
                <input className="input" value={courier} onChange={(e) => setCourier(e.target.value)} />
              </div>
              <div>
                <label className="label">Tracking number</label>
                <input className="input" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Tracking URL (optional)</label>
                <input className="input" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} />
              </div>
            </div>
            <button
              className="btn-primary mt-3"
              disabled={saveTracking.isPending || !courier.trim() || !trackingNo.trim()}
              onClick={() => { setError(''); saveTracking.mutate(); }}
            >
              {saveTracking.isPending ? 'Saving…' : 'Save tracking'}
            </button>
          </section>
        )}

        {!editing && canCancel && (
          <section className="mt-6 border-t border-slate-200 pt-6">
            <h3 className="text-sm font-semibold text-red-700">Cancel order</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Reason</label>
                <input className="input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Why is this order being cancelled?" />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={refundOnCancel} onChange={(e) => setRefundOnCancel(e.target.checked)} />
                Mark payment as refunded
              </label>
            </div>
            <button
              className="btn-ghost mt-3 border-red-200 text-red-600 hover:bg-red-50"
              disabled={cancel.isPending || !cancelReason.trim()}
              onClick={() => {
                if (!window.confirm(`Cancel order ${order.order_number}?`)) return;
                setError('');
                cancel.mutate();
              }}
            >
              {cancel.isPending ? 'Cancelling…' : 'Cancel order'}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function OrdersTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['book-orders'],
    queryFn: () =>
      unwrap<{ items: Order[]; total: number }>(
        api.get('/books/admin/orders', { params: { page_size: 500 } }),
      ),
  });

  const rows = (data?.items ?? []).filter((o) => !status || o.status === status);

  const columns: Column<Order>[] = [
    { key: 'order_number', header: 'Order #', sort: (o) => o.order_number, cell: (o) => <span className="font-mono font-semibold">{o.order_number}</span> },
    {
      key: 'buyer_name',
      header: 'Buyer',
      sort: (o) => o.buyer_name,
      cell: (o) => <>{o.buyer_name}<div className="text-xs text-slate-400"><PhoneLink phone={o.phone} className="text-xs" /></div></>,
    },
    { key: 'delivery_type', header: 'Type', sort: (o) => o.delivery_type, cell: (o) => <span className="capitalize">{o.delivery_type}</span> },
    { key: 'amount', header: 'Amount', align: 'right', sort: (o) => o.amount, cell: (o) => rupees(o.amount) },
    { key: 'tracking', header: 'Tracking', cell: (o) => <span className="text-xs">{o.tracking_number ? `${o.courier_name} · ${o.tracking_number}` : '—'}</span> },
    { key: 'status', header: 'Status', sort: (o) => o.status, cell: (o) => <span className="badge bg-slate-100 text-slate-700">{o.status}</span> },
    { key: 'actions', header: '', width: '1%', cell: (o) => <button className="btn-ghost py-1 text-xs" onClick={() => setViewOrderId(o.id)}>View</button> },
  ];

  return (
    <div>
      <DataTable
        rows={rows}
        columns={columns}
        loading={isLoading}
        rowKey={(o) => o.id}
        searchText={(o) => `${o.order_number} ${o.buyer_name} ${o.phone} ${o.tracking_number ?? ''}`}
        searchPlaceholder="Search order #, name, phone, tracking"
        emptyLabel="No orders found."
        filters={
          <TableFilter
            value={status}
            onChange={setStatus}
            options={[{ value: '', label: 'All statuses' }, ...ORDER_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        }
      />

      {viewOrderId && (
        <OrderDetailModal
          orderId={viewOrderId}
          onClose={() => setViewOrderId(null)}
          onUpdated={() => qc.invalidateQueries({ queryKey: ['book-orders'] })}
        />
      )}
    </div>
  );
}

interface Product {
  id: string;
  name: string;
  sku: string;
  version: string;
  price: number;
  offer_price?: number | null;
  stock: number;
  reserved: number;
  available: number;
  low_stock: boolean;
  low_stock_threshold?: number;
  status: string;
  visible: boolean;
  language?: string;
  description?: string | null;
  cover_image_url?: string | null;
  gallery?: string[];
  gst_rate?: number;
  is_speakedge_book?: boolean;
}

interface ProductDetail extends Product {
  sell_price: number;
  weight_g?: number | null;
  created_at?: string;
  updated_at?: string;
}

const BOOK_VERSIONS = [
  'British English',
  'American English',
  'International English',
] as const;

interface ProductDetailForm {
  name: string;
  version: (typeof BOOK_VERSIONS)[number];
  language: string;
  description: string;
  priceRupees: string;
  offerPriceRupees: string;
  gstRate: string;
  lowStockThreshold: string;
  status: 'active' | 'inactive';
  visible: boolean;
  isSpeakedgeBook: boolean;
}

interface ProductFormState {
  name: string;
  sku: string;
  version: (typeof BOOK_VERSIONS)[number];
  language: string;
  description: string;
  priceRupees: string;
  offerPriceRupees: string;
  stock: string;
  lowStockThreshold: string;
  status: 'active' | 'inactive';
  visible: boolean;
}

function emptyProductForm(): ProductFormState {
  return {
    name: '',
    sku: '',
    version: 'International English',
    language: 'English',
    description: '',
    priceRupees: '',
    offerPriceRupees: '',
    stock: '0',
    lowStockThreshold: '10',
    status: 'active',
    visible: true,
  };
}

function productToForm(p: Product): ProductFormState {
  return {
    name: p.name,
    sku: p.sku,
    version: (BOOK_VERSIONS.includes(p.version as (typeof BOOK_VERSIONS)[number])
      ? p.version
      : 'International English') as (typeof BOOK_VERSIONS)[number],
    language: 'English',
    description: p.description ?? '',
    priceRupees: String(p.price / 100),
    offerPriceRupees: p.offer_price != null ? String(p.offer_price / 100) : '',
    stock: String(p.stock),
    lowStockThreshold: String(p.low_stock_threshold ?? 10),
    status: p.status === 'inactive' ? 'inactive' : 'active',
    visible: p.visible,
  };
}

function rupeesToPaise(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Enter a valid price');
  return Math.round(n * 100);
}

function ProductFormModal({
  mode,
  product,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  product?: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProductFormState>(
    mode === 'edit' && product ? productToForm(product) : emptyProductForm(),
  );
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      const price = rupeesToPaise(form.priceRupees);
      const offerPrice = form.offerPriceRupees.trim()
        ? rupeesToPaise(form.offerPriceRupees)
        : null;

      if (mode === 'create') {
        if (!form.name.trim()) throw new Error('Name is required');
        if (!form.sku.trim()) throw new Error('SKU is required');
        const stock = Number(form.stock);
        if (!Number.isInteger(stock) || stock < 0) throw new Error('Stock must be a non-negative whole number');
        return unwrap(
          api.post('/books/admin/products', {
            name: form.name.trim(),
            sku: form.sku.trim(),
            version: form.version,
            language: form.language.trim() || 'English',
            description: form.description.trim() || null,
            price,
            offer_price: offerPrice,
            stock,
            low_stock_threshold: Number(form.lowStockThreshold) || 10,
            status: form.status,
            visible: form.visible,
          }),
        );
      }

      if (!product) throw new Error('Product not found');
      return unwrap(
        api.patch(`/books/admin/products/${product.id}`, {
          name: form.name.trim(),
          version: form.version,
          description: form.description.trim() || null,
          price,
          offer_price: offerPrice,
          low_stock_threshold: Number(form.lowStockThreshold) || 10,
          status: form.status,
          visible: form.visible,
        }),
      );
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const set = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <h2 className="text-lg font-bold">{mode === 'create' ? 'Add book' : 'Edit book'}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={4}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What the book covers, who it is for, what is included…"
            />
            <p className="mt-1 text-xs text-slate-400">Shown to buyers on the shop product page.</p>
          </div>
          {mode === 'create' && (
            <div>
              <label className="label">SKU</label>
              <input className="input font-mono" value={form.sku} onChange={(e) => set('sku', e.target.value)} />
            </div>
          )}
          {mode === 'create' && (
            <div>
              <label className="label">Initial stock</label>
              <input
                className="input"
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => set('stock', e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="label">Version</label>
            <select className="input" value={form.version} onChange={(e) => set('version', e.target.value as ProductFormState['version'])}>
              {BOOK_VERSIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value as 'active' | 'inactive')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="label">Price (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={form.priceRupees}
              onChange={(e) => set('priceRupees', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Offer price (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              placeholder="Optional"
              value={form.offerPriceRupees}
              onChange={(e) => set('offerPriceRupees', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Low-stock alert at</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.lowStockThreshold}
              onChange={(e) => set('lowStockThreshold', e.target.value)}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.visible} onChange={(e) => set('visible', e.target.checked)} />
              Visible in shop
            </label>
          </div>
        </div>
        {mode === 'create' && (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            Cover and gallery photos are uploaded from the book's page once it exists — add the book,
            then open it and use <span className="font-semibold">Upload photos</span>.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={save.isPending}>Cancel</button>
          <button className="btn-primary" onClick={() => { setError(''); save.mutate(); }} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : mode === 'create' ? 'Add book' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function productDetailToForm(p: ProductDetail): ProductDetailForm {
  return {
    name: p.name,
    version: (BOOK_VERSIONS.includes(p.version as (typeof BOOK_VERSIONS)[number])
      ? p.version
      : 'International English') as (typeof BOOK_VERSIONS)[number],
    language: p.language ?? 'English',
    description: p.description ?? '',
    priceRupees: String(p.price / 100),
    offerPriceRupees: p.offer_price != null ? String(p.offer_price / 100) : '',
    gstRate: String(p.gst_rate ?? 0),
    lowStockThreshold: String(p.low_stock_threshold ?? 10),
    status: p.status === 'inactive' ? 'inactive' : 'active',
    visible: p.visible,
    isSpeakedgeBook: !!p.is_speakedge_book,
  };
}

function ProductDetailModal({
  productId,
  onClose,
  onUpdated,
}: {
  productId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProductDetailForm | null>(null);
  const [error, setError] = useState('');

  const { data: product, isLoading, refetch } = useQuery({
    queryKey: ['book-product', productId],
    queryFn: () => unwrap<ProductDetail>(api.get(`/books/admin/products/${productId}`)),
  });

  useEffect(() => {
    if (product && !editing) setForm(productDetailToForm(product));
  }, [product, editing]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['book-products'] });
    qc.invalidateQueries({ queryKey: ['book-product', productId] });
    onUpdated();
  };

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error('Nothing to save');
      const price = rupeesToPaise(form.priceRupees);
      const offerPrice = form.offerPriceRupees.trim() ? rupeesToPaise(form.offerPriceRupees) : null;
      const gst = Number(form.gstRate);
      if (!Number.isFinite(gst) || gst < 0) throw new Error('Enter a valid GST rate');
      return unwrap(
        api.patch(`/books/admin/products/${productId}`, {
          name: form.name.trim(),
          version: form.version,
          language: form.language.trim() || 'English',
          description: form.description.trim() || null,
          price,
          offer_price: offerPrice,
          gst_rate: gst,
          low_stock_threshold: Number(form.lowStockThreshold) || 10,
          status: form.status,
          visible: form.visible,
          is_speakedge_book: form.isSpeakedgeBook,
        }),
      );
    },
    onSuccess: () => {
      setError('');
      setEditing(false);
      invalidateAll();
      refetch();
    },
    onError: (e: Error) => setError(e.message),
  });

  const uploadImages = useMutation({
    mutationFn: (files: FileList) => {
      const fd = new FormData();
      Array.from(files).forEach((file) => fd.append('files', file));
      return unwrap<ProductDetail>(api.post(`/books/admin/products/${productId}/gallery`, fd));
    },
    onSuccess: () => {
      setError('');
      invalidateAll();
      refetch();
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (e: Error) => setError(e.message),
  });

  const updateImages = useMutation({
    mutationFn: (payload: { gallery: string[]; cover_image_url?: string | null }) =>
      unwrap(api.patch(`/books/admin/products/${productId}`, payload)),
    onSuccess: () => {
      setError('');
      invalidateAll();
      refetch();
    },
    onError: (e: Error) => setError(e.message),
  });

  const setField = <K extends keyof ProductDetailForm>(key: K, value: ProductDetailForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const allImages = product
    ? [...new Set([product.cover_image_url, ...(product.gallery ?? [])].filter(Boolean) as string[])]
    : [];

  const setCover = (url: string) => {
    const gallery = product?.gallery ?? [];
    const merged = gallery.includes(url) ? gallery : [url, ...gallery.filter((u) => u !== url)];
    updateImages.mutate({ gallery: merged, cover_image_url: url });
  };

  const removeImage = (url: string) => {
    if (!product) return;
    const gallery = (product.gallery ?? []).filter((u) => u !== url);
    const cover = product.cover_image_url === url ? (gallery[0] ?? null) : product.cover_image_url;
    updateImages.mutate({ gallery, cover_image_url: cover });
  };

  if (isLoading || !product || !form) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
        <div className="card w-full max-w-3xl">
          <p className="text-slate-500">{isLoading ? 'Loading book…' : 'Book not found.'}</p>
          <button className="btn-ghost mt-4" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{product.name}</h2>
            <p className="font-mono text-sm text-slate-500">{product.sku}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!editing && (
              <button className="btn-ghost py-1 text-xs" onClick={() => setEditing(true)}>Edit</button>
            )}
            <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className={`badge ${product.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
            {product.status}
          </span>
          <span className="badge bg-slate-100 text-slate-600">{product.version}</span>
          {!product.visible && <span className="badge bg-amber-100 text-amber-700">hidden</span>}
          {product.low_stock && <span className="badge bg-red-100 text-red-700">low stock</span>}
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Cover photos</h3>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => e.target.files?.length && uploadImages.mutate(e.target.files)}
              />
              <button
                className="btn-ghost py-1 text-xs"
                disabled={uploadImages.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {uploadImages.isPending ? 'Uploading…' : 'Upload photos'}
              </button>
            </div>
          </div>
          {allImages.length ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {allImages.map((url) => (
                <div key={url} className="relative overflow-hidden rounded-lg border border-slate-200">
                  <img src={url} alt="" className="aspect-[3/4] w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-black/50 p-1">
                    {product.cover_image_url === url ? (
                      <span className="badge bg-brand text-white">Cover</span>
                    ) : (
                      <button
                        className="btn-ghost py-0.5 text-[10px] text-white hover:bg-white/20"
                        disabled={updateImages.isPending}
                        onClick={() => setCover(url)}
                      >
                        Set cover
                      </button>
                    )}
                    <button
                      className="btn-ghost py-0.5 text-[10px] text-red-200 hover:bg-red-500/30"
                      disabled={updateImages.isPending}
                      onClick={() => {
                        if (window.confirm('Remove this photo?')) removeImage(url);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No photos yet. Upload one or more cover images.</p>
          )}
        </section>

        {!editing ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2">
              <DetailRow label="Language" value={product.language ?? 'English'} />
              <DetailRow label="Price" value={rupees(product.offer_price ?? product.price)} />
              <DetailRow label="MRP" value={rupees(product.price)} />
              <DetailRow label="GST" value={`${product.gst_rate ?? 0}%`} />
              <DetailRow label="Stock" value={`${product.stock} (${product.reserved} reserved, ${product.available} available)`} />
              <DetailRow label="Low-stock alert" value={product.low_stock_threshold ?? 10} />
              <DetailRow
                label="Membership bundle"
                value={product.is_speakedge_book ? 'SpeakEdge Book — sold with a membership' : 'Normal purchase flow'}
              />
            </section>
            {product.description && (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-slate-700">Description</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{product.description}</p>
              </section>
            )}
          </>
        ) : (
          <section className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setField('name', e.target.value)} />
            </div>
            <div>
              <label className="label">Version</label>
              <select className="input" value={form.version} onChange={(e) => setField('version', e.target.value as ProductDetailForm['version'])}>
                {BOOK_VERSIONS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Language</label>
              <input className="input" value={form.language} onChange={(e) => setField('language', e.target.value)} />
            </div>
            <div>
              <label className="label">Price (₹)</label>
              <input className="input" type="number" min={0} step="0.01" value={form.priceRupees} onChange={(e) => setField('priceRupees', e.target.value)} />
            </div>
            <div>
              <label className="label">Offer price (₹)</label>
              <input className="input" type="number" min={0} step="0.01" placeholder="Optional" value={form.offerPriceRupees} onChange={(e) => setField('offerPriceRupees', e.target.value)} />
            </div>
            <div>
              <label className="label">GST (%)</label>
              <input className="input" type="number" min={0} step="0.1" value={form.gstRate} onChange={(e) => setField('gstRate', e.target.value)} />
            </div>
            <div>
              <label className="label">Low-stock alert at</label>
              <input className="input" type="number" min={0} value={form.lowStockThreshold} onChange={(e) => setField('lowStockThreshold', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={(e) => setField('status', e.target.value as 'active' | 'inactive')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.visible} onChange={(e) => setField('visible', e.target.checked)} />
                Visible in shop
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <textarea className="input" rows={4} value={form.description} onChange={(e) => setField('description', e.target.value)} />
              <p className="mt-1 text-xs text-slate-400">Shown under this book in the Book Shop.</p>
            </div>
            <div className="sm:col-span-2 rounded-lg border border-slate-200 p-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.isSpeakedgeBook}
                  onChange={(e) => setField('isSpeakedgeBook', e.target.checked)}
                />
                <span>
                  This is the <strong>SpeakEdge Book</strong>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Buyers are routed to Choose Your Membership first and pay for the plan and
                    book in one checkout. Only one product can hold this — flagging this one
                    clears any other.
                  </span>
                </span>
              </label>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button className="btn-primary" disabled={save.isPending} onClick={() => { setError(''); save.mutate(); }}>
                {save.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function StockModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qty, setQty] = useState('');
  const [kind, setKind] = useState<'restock' | 'adjust'>('restock');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const adjust = useMutation({
    mutationFn: async () => {
      const n = Number(qty);
      if (!Number.isInteger(n) || n === 0) throw new Error('Enter a non-zero whole number');
      if (kind === 'restock' && n < 0) throw new Error('Restock quantity must be positive');
      return unwrap(
        api.post(`/books/admin/products/${product.id}/inventory`, {
          kind,
          qty: kind === 'restock' ? n : n,
          reason: reason.trim() || undefined,
        }),
      );
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md">
        <h2 className="text-lg font-bold">Update stock</h2>
        <p className="mt-1 text-sm text-slate-600">
          {product.name} · current {product.stock} on hand ({product.reserved} reserved, {product.available} available)
        </p>
        <div className="mt-4 grid gap-3">
          <div>
            <label className="label">Adjustment type</label>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'restock' | 'adjust')}>
              <option value="restock">Add stock (restock)</option>
              <option value="adjust">Adjust (+ or −)</option>
            </select>
          </div>
          <div>
            <label className="label">{kind === 'restock' ? 'Quantity to add' : 'Change (+/−)'}</label>
            <input
              className="input"
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={kind === 'restock' ? '50' : '-5'}
            />
          </div>
          <div>
            <label className="label">Reason (optional)</label>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={adjust.isPending}>Cancel</button>
          <button className="btn-primary" onClick={() => { setError(''); adjust.mutate(); }} disabled={adjust.isPending}>
            {adjust.isPending ? 'Updating…' : 'Update stock'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductsTab() {
  const qc = useQueryClient();
  const [formMode, setFormMode] = useState<'create' | null>(null);
  const [viewProductId, setViewProductId] = useState<string | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [actionError, setActionError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['book-products'],
    queryFn: () => unwrap<Product[]>(api.get('/books/admin/products')),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['book-products'] });

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/books/admin/products/${id}`)),
    onSuccess: () => {
      setActionError('');
      invalidate();
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const confirmDelete = (p: Product) => {
    if (!window.confirm(`Delete "${p.name}" (${p.sku})? This hides it from the shop.`)) return;
    remove.mutate(p.id);
  };

  const productColumns: Column<Product>[] = [
    { key: 'sku', header: 'SKU', sort: (p) => p.sku, cell: (p) => <span className="font-mono font-semibold">{p.sku}</span> },
    { key: 'name', header: 'Name', sort: (p) => p.name },
    { key: 'version', header: 'Version', sort: (p) => p.version },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      sort: (p) => p.offer_price ?? p.price,
      cell: (p) => (
        <>{rupees(p.offer_price ?? p.price)}{p.offer_price != null && <span className="ml-1 text-xs text-slate-400 line-through">{rupees(p.price)}</span>}</>
      ),
    },
    { key: 'stock', header: 'Stock', align: 'right', sort: (p) => p.stock, cell: (p) => <>{p.stock} <span className="text-xs text-slate-400">({p.reserved} rsvd)</span></> },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      sort: (p) => p.available,
      cell: (p) => <><span className={p.low_stock ? 'font-semibold text-red-600' : ''}>{p.available}</span>{p.low_stock && <span className="badge ml-1 bg-red-100 text-red-700">low</span>}</>,
    },
    {
      key: 'status',
      header: 'Status',
      sort: (p) => p.status,
      cell: (p) => (
        <><span className={`badge ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{p.status}</span>{!p.visible && <span className="badge ml-1 bg-amber-100 text-amber-700">hidden</span>}</>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (p) => (
        <div className="flex flex-wrap gap-1">
          <button className="btn-ghost py-1 text-xs" onClick={() => setViewProductId(p.id)}>View</button>
          <button className="btn-ghost py-1 text-xs" onClick={() => setStockProduct(p)}>Stock</button>
          <button className="btn-ghost py-1 text-xs text-red-600 hover:bg-red-50" disabled={remove.isPending} onClick={() => confirmDelete(p)}>Delete</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{data?.length ?? 0} products</p>
        <button className="btn-primary" onClick={() => setFormMode('create')}>
          Add book
        </button>
      </div>

      {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}

      <DataTable
        rows={data}
        columns={productColumns}
        loading={isLoading}
        rowKey={(p) => p.id}
        searchText={(p) => `${p.sku} ${p.name} ${p.version}`}
        searchPlaceholder="Search SKU / name"
        emptyLabel="No products yet. Add your first book."
      />

      {formMode === 'create' && (
        <ProductFormModal
          mode="create"
          onClose={() => setFormMode(null)}
          onSaved={invalidate}
        />
      )}
      {viewProductId && (
        <ProductDetailModal
          productId={viewProductId}
          onClose={() => setViewProductId(null)}
          onUpdated={invalidate}
        />
      )}
      {stockProduct && (
        <StockModal
          product={stockProduct}
          onClose={() => setStockProduct(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

export function AdminBooks() {
  const [tab, setTab] = useState<'orders' | 'products'>('orders');
  return (
    <div>
      <h1 className="text-2xl font-extrabold">Book Purchase Management</h1>
      <div className="mt-4 flex gap-2">
        {(['orders', 'products'] as const).map((t) => (
          <button
            key={t}
            className={`rounded-lg px-4 py-2 text-sm font-medium capitalize ${
              tab === t ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600'
            }`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'orders' ? <OrdersTab /> : <ProductsTab />}
    </div>
  );
}

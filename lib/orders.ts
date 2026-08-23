import fs from 'node:fs';
import path from 'node:path';
import { OrderSchema, type Order } from './types';

const ORDERS_PATH = path.join(process.cwd(), 'data', 'orders.json');

let cached: Order[] | null = null;

export function loadOrders(): Order[] {
  if (cached) return cached;
  const raw = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
  cached = OrderSchema.array().parse(raw);
  return cached;
}

/** Normalises "nx 482913", "NX482913" and "nx-482913" to "NX-482913". */
export function normalizeOrderRef(raw: string): string | null {
  const digits = raw.toUpperCase().replace(/[^0-9]/g, '');
  return digits.length === 6 ? `NX-${digits}` : null;
}

export function findOrder(ref: string): Order | null {
  const normalised = normalizeOrderRef(ref);
  if (!normalised) return null;
  return loadOrders().find((order) => order.orderRef === normalised) ?? null;
}

/**
 * The order block handed to Claude. Only fields that exist on the record are
 * rendered, so the model cannot mistake an absent field for a real value.
 */
export function formatOrderForPrompt(order: Order): string {
  const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`;
  const lines: string[] = [
    `reference: ${order.orderRef}`,
    `customer: ${order.customerName}`,
    `destination: ${order.city}, ${order.state}`,
    `status: ${order.status}`,
    `status detail: ${order.statusDetail}`,
    `items: ${order.items.map((i) => `${i.qty} x ${i.name} at ${naira(i.unitPrice)}`).join('; ')}`,
    `merchandise value: ${naira(order.merchandiseValue)}`,
    `delivery fee: ${naira(order.deliveryFee)}`,
    `total value: ${naira(order.totalValue)}`,
    `payment: ${order.paymentMethod} (${order.paymentStatus})`,
    `placed: ${order.placedAt}`,
  ];
  if (order.dispatchedAt) lines.push(`dispatched: ${order.dispatchedAt}`);
  if (order.promisedBy) lines.push(`promised by: ${order.promisedBy}`);
  if (order.deliveredAt) lines.push(`delivered: ${order.deliveredAt}`);
  if (order.trackingId) lines.push(`tracking id: ${order.trackingId}`);
  if (order.refund) {
    lines.push(
      `refund: ${naira(order.refund.amount)} via ${order.refund.method}, approved ${order.refund.approvedAt}, status ${order.refund.status}`,
    );
  }
  return `<order>\n${lines.join('\n')}\n</order>`;
}

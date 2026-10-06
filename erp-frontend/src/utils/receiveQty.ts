/**
 * @author: Wendy Yang
 * @date: 2026-10-06
 */

export function overReceiveDetail(itemId: string, qty: number, remaining: number): string {
  return `Quantity ${qty} exceeds remaining receivable ${remaining} for ${itemId}. Over-receipt is not allowed.`
}

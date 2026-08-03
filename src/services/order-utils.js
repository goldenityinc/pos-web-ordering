/**
 * @typedef {Object} OrderItemInput
 * @property {string} productId
 * @property {{ id?: string } | null | undefined} [product]
 * @property {string | null | undefined} [product_id]
 */

/**
 * Resolve the actual product id for an order item.
 *
 * @param {OrderItemInput} item
 * @returns {string}
 */
export function resolveOrderItemProductId(item) {
  return item.product?.id ?? item.product_id ?? item.productId;
}

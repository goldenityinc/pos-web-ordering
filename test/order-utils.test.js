const assert = require("node:assert");
const { resolveOrderItemProductId } = require("../src/services/order-utils.js");

test("returns nested product id when available", () => {
  const item = {
    product: { id: "real-product-123" },
    product_id: "fallback-456",
    productId: "row-789",
  };

  assert.strictEqual(resolveOrderItemProductId(item), "real-product-123");
});

test("falls back to product_id when product.id is absent", () => {
  const item = {
    product: {},
    product_id: "fallback-456",
    productId: "row-789",
  };

  assert.strictEqual(resolveOrderItemProductId(item), "fallback-456");
});

test("falls back to productId when nested id fields are absent", () => {
  const item = {
    product: {},
    productId: "row-789",
  };

  assert.strictEqual(resolveOrderItemProductId(item), "row-789");
});

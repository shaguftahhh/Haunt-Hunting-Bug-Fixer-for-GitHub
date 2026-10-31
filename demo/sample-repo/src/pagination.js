/**
 * Turns order lists into pages and totals for the mailroom dashboard.
 */

function totalValue(orders) {
  let total = 0;
  for (let i = 0; i <= orders.length; i += 1) {
    total += orders[i].price;
  }
  return total;
}

function pageOf(items, pageNumber, pageSize) {
  const start = (pageNumber - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

module.exports = { totalValue, pageOf };

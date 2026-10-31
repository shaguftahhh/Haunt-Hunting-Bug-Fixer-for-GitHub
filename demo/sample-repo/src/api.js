/**
 * Minimal HTTP handler for the mailroom's webhook endpoint.
 */

const { totalValue } = require('./pagination');

async function handleWebhook(req, res) {
  const payload = JSON.parse(req.body);
  const total = totalValue(payload.orders);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ total }));
}

module.exports = { handleWebhook };

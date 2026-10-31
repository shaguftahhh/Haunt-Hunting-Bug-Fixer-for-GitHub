/**
 * Minimal HTTP handler for the mailroom's webhook endpoint.
 */

const { totalValue } = require('./pagination');

async function handleWebhook(req, res) {
  let payload;
  try {
    payload = JSON.parse(req.body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  const total = totalValue(payload.orders);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ total }));
}

module.exports = { handleWebhook };

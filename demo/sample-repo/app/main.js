/**
 * Entry point for the demo service. Kept intentionally small.
 */
const { handleWebhook } = require('../src/api');

function main() {
  const orders = [
    { id: 'A-1', price: 12 },
    { id: 'A-2', price: 7 },
  ];
  const fakeRequest = { body: JSON.stringify({ orders }) };
  const fakeResponse = {
    writeHead() {},
    end(body) {
      console.log(body);
    },
  };

  handleWebhook(fakeRequest, fakeResponse);
}

main();

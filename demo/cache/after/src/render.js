/**
 * Renders the recipient list in the mailroom dashboard.
 */

function renderRecipients(listElement, recipients) {
  listElement.textContent = '';
  for (const recipient of recipients) {
    const item = document.createElement('li');
    item.className = 'recipient';
    item.textContent = recipient.name;
    listElement.appendChild(item);
  }
}

module.exports = { renderRecipients };

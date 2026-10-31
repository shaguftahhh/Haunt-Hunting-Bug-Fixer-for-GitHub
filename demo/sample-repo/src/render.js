/**
 * Renders the recipient list in the mailroom dashboard.
 */

function renderRecipients(listElement, recipients) {
  let html = '';
  for (const recipient of recipients) {
    html += '<li class="recipient">' + recipient.name + '</li>';
  }
  listElement.innerHTML = html;
}

module.exports = { renderRecipients };

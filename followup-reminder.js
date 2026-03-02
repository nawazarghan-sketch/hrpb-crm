// Daily follow-up reminder script
// Reads today's follow-ups from CRM database and returns formatted message

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'crm.db'), { readonly: true });

const today = new Date().toISOString().split('T')[0];

// Today's follow-ups
const todayClients = db.prepare(`
  SELECT c.name, c.contact, p.name as project_name, c.interest_level
  FROM clients c
  LEFT JOIN projects p ON c.project_id = p.id
  WHERE c.followup_date = ?
  ORDER BY c.name
`).all(today);

// Overdue follow-ups
const overdueClients = db.prepare(`
  SELECT c.name, c.contact, c.followup_date, p.name as project_name
  FROM clients c
  LEFT JOIN projects p ON c.project_id = p.id
  WHERE c.followup_date < ?
  AND c.interest_level NOT IN ('close_won', 'close_lost', 'not_interested')
  ORDER BY c.followup_date
`).all(today);

let msg = '';

if (todayClients.length > 0) {
  msg += `📅 *Aaj ke Follow-ups (${today})*\n\n`;
  todayClients.forEach((c, i) => {
    msg += `${i + 1}. *${c.name}*`;
    if (c.contact) msg += ` — ${c.contact}`;
    if (c.project_name) msg += ` (${c.project_name})`;
    msg += `\n`;
  });
}

if (overdueClients.length > 0) {
  msg += `\n⚠️ *Overdue Follow-ups (${overdueClients.length})*\n\n`;
  overdueClients.forEach((c, i) => {
    msg += `${i + 1}. *${c.name}*`;
    if (c.contact) msg += ` — ${c.contact}`;
    msg += ` (due: ${c.followup_date})`;
    if (c.project_name) msg += ` [${c.project_name}]`;
    msg += `\n`;
  });
}

if (!msg) {
  msg = '✅ Aaj koi follow-up nahi hai. Enjoy your day!';
}

console.log(msg);

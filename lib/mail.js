// Laiškų siuntimas per Gmail (reikia „programos slaptažodžio“).
// Aplinkos kintamieji: GMAIL_USER (pvz., vardas@gmail.com), GMAIL_APP_PASSWORD.

let transporter = null;

function mailEnabled() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

async function sendMail({ to, subject, text }) {
  if (!mailEnabled() || !to) return false;
  if (!transporter) {
    const nodemailer = require("nodemailer");
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
    });
  }
  await transporter.sendMail({ from: `Genties susitikimas <${process.env.GMAIL_USER}>`, to, subject, text });
  return true;
}

module.exports = { mailEnabled, sendMail };

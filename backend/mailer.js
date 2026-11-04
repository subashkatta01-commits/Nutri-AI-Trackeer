const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export async function sendMail({ to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const fromEmail = process.env.MAIL_FROM_EMAIL?.trim();
  const fromName = process.env.MAIL_FROM_NAME?.trim() || 'NutriAI Tracker';

  if (!apiKey || !fromEmail) {
    throw new Error('Email verification is not configured. Set BREVO_API_KEY and MAIL_FROM_EMAIL.');
  }

  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      ...(text ? { textContent: text } : {})
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const error = new Error(`Brevo API error (HTTP ${response.status}): ${errorBody || response.statusText}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

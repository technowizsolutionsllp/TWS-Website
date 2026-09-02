import { NextResponse } from 'next/server';
import { contactEmail, services } from '../../company-data';

const allowedServices = new Set(services.map((service) => service.title));

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
  }

  const data = payload as Record<string, unknown>;
  const name = cleanString(data.name, 120);
  const email = cleanString(data.email, 180);
  const service = cleanString(data.service, 120);
  const message = cleanString(data.message, 4000);
  const website = cleanString(data.website, 180);

  if (website) {
    return NextResponse.json({ ok: true });
  }

  if (!name || !email || !message) {
    return NextResponse.json(
      { message: 'Name, email ID, and message are required.' },
      { status: 400 },
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ message: 'Enter a valid email ID.' }, { status: 400 });
  }

  if (service && !allowedServices.has(service)) {
    return NextResponse.json({ message: 'Select a valid service.' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.CONTACT_FROM_EMAIL?.trim();
  const toEmail = (process.env.CONTACT_TO_EMAIL || contactEmail).trim();

  if (!apiKey || !fromEmail) {
    return NextResponse.json(
      { message: 'Contact email delivery is not configured yet.' },
      { status: 503 },
    );
  }

  const subject = `Technowiz Solutions enquiry from ${name}`;
  const text = [
    `Name: ${name}`,
    `Email ID: ${email}`,
    `Service interest: ${service || 'Not selected'}`,
    '',
    'Message:',
    message,
  ].join('\n');

  let response: Response;

  const resendBody = JSON.stringify({
    from: fromEmail,
    to: [toEmail],
    reply_to: email,
    subject,
    text,
  });

  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: resendBody,
    });
  } catch {
    return NextResponse.json(
      { message: 'Could not reach the email service. Please try again.' },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error('Resend API error', response.status, response.statusText, errorBody);
    return NextResponse.json(
      { message: 'Could not send the message. Please try again.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}

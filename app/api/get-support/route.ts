import { NextResponse } from 'next/server';
import { contactEmail } from '../../company-data';
import {
  BLOCKED_EXTENSIONS,
  MAX_EMAIL,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_MESSAGE,
  MAX_NAME,
  MAX_SCREENSHOTS,
  MAX_SUBJECT,
  MAX_TOTAL_BYTES,
  OTHER_PRODUCT,
  fileExtension,
  formatBytes,
} from '../../get-support/limits';
import { products } from '../../products/data';

// Support requests are always copied here, in addition to CONTACT_TO_EMAIL.
const SUPPORT_COPY_EMAIL = 'technowizsolutionsllp@gmail.com';

const allowedProducts = new Set([...products.map((product) => product.name), OTHER_PRODUCT]);

const SCREENSHOT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

type UploadedFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as UploadedFile).arrayBuffer === 'function' &&
    typeof (value as UploadedFile).name === 'string'
  );
}

function sanitizeFilename(name: string) {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(-120);

  return cleaned || 'attachment';
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function fail(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

export async function POST(request: Request) {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return fail('Invalid request body.');
  }

  const name = cleanString(form.get('name'), MAX_NAME);
  const email = cleanString(form.get('email'), MAX_EMAIL);
  const product = cleanString(form.get('product'), 120);
  const subject = cleanString(form.get('subject'), MAX_SUBJECT).replace(/\s+/g, ' ');
  const message = cleanString(form.get('message'), MAX_MESSAGE);
  const website = cleanString(form.get('website'), 180);

  // Honeypot: bots fill the hidden field. Pretend success.
  if (website) {
    return NextResponse.json({ ok: true });
  }

  if (!name || !email || !product || !subject || !message) {
    return fail('Name, email ID, product, subject, and a description of your issue are required.');
  }

  if (!allowedProducts.has(product)) {
    return fail('Select a valid product.');
  }

  if (!isValidEmail(email)) {
    return fail('Enter a valid email ID.');
  }

  const getFiles = (key: string) =>
    (form.getAll(key) as unknown[]).filter(isUploadedFile).filter((file) => file.size > 0);
  const screenshots = getFiles('screenshots');
  const attachments = getFiles('attachments');

  if (screenshots.length > MAX_SCREENSHOTS) {
    return fail(`You can attach up to ${MAX_SCREENSHOTS} screenshots.`);
  }

  if (attachments.length > MAX_FILES) {
    return fail(`You can attach up to ${MAX_FILES} files.`);
  }

  let totalBytes = 0;

  for (const file of screenshots) {
    if (!SCREENSHOT_TYPES.has(file.type)) {
      return fail(`"${file.name}" is not a supported screenshot. Use PNG, JPG, GIF, or WebP.`);
    }
  }

  for (const file of [...screenshots, ...attachments]) {
    if (BLOCKED_EXTENSIONS.has(fileExtension(file.name))) {
      return fail(`"${file.name}" is an executable or script file type that cannot be attached.`);
    }

    if (file.size > MAX_FILE_BYTES) {
      return fail(`"${file.name}" is larger than ${formatBytes(MAX_FILE_BYTES)}.`);
    }

    totalBytes += file.size;
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    return fail(`Attachments are larger than ${formatBytes(MAX_TOTAL_BYTES)} in total.`);
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.CONTACT_FROM_EMAIL?.trim();
  const primaryTo = (process.env.CONTACT_TO_EMAIL || contactEmail).trim();

  if (!apiKey || !fromEmail) {
    return fail('Support email delivery is not configured yet.', 503);
  }

  const recipients = Array.from(
    new Set([primaryTo, SUPPORT_COPY_EMAIL].map((address) => address.toLowerCase())),
  );

  const resendAttachments: { filename: string; content: string; content_type?: string }[] = [];
  const usedNames = new Set<string>();

  async function addAttachment(file: UploadedFile, prefix: string) {
    let filename = sanitizeFilename(file.name);

    if (usedNames.has(filename)) {
      filename = `${prefix}-${resendAttachments.length + 1}-${filename}`;
    }

    usedNames.add(filename);
    resendAttachments.push({
      filename,
      content: toBase64(new Uint8Array(await file.arrayBuffer())),
      content_type: file.type || undefined,
    });
  }

  for (const file of screenshots) {
    await addAttachment(file, 'screenshot');
  }

  for (const file of attachments) {
    await addAttachment(file, 'file');
  }

  const attachmentSummary = resendAttachments.length
    ? resendAttachments.map((item) => `- ${item.filename}`).join('\n')
    : 'None';

  const text = [
    `Name: ${name}`,
    `Email ID: ${email}`,
    `Product: ${product}`,
    `Subject: ${subject}`,
    '',
    'Describe your issue:',
    message,
    '',
    `Attachments (${resendAttachments.length}):`,
    attachmentSummary,
  ].join('\n');

  let response: Response;

  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        reply_to: email,
        subject: `[Support - ${product}] ${subject} - ${name}`,
        text,
        attachments: resendAttachments.length ? resendAttachments : undefined,
      }),
    });
  } catch {
    return fail('Could not reach the email service. Please try again.', 502);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error('Resend API error (get-support)', response.status, response.statusText, errorBody);
    return fail('Could not send your request. Please try again.', 502);
  }

  return NextResponse.json({ ok: true });
}

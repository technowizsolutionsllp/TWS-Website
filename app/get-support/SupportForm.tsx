'use client';

import {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  BLOCKED_EXTENSIONS,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_MESSAGE,
  MAX_SCREENSHOTS,
  MAX_TOTAL_BYTES,
  OTHER_PRODUCT,
  fileExtension,
  formatBytes,
  isLogExport,
  logFileExample,
} from './limits';

type Shot = { id: string; file: File; url: string };

const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

let counter = 0;
const nextId = () => `f${Date.now()}-${counter++}`;

export default function SupportForm({ products }: { products: string[] }) {
  const formId = useId();
  const [shots, setShots] = useState<Shot[]>([]);
  const [files, setFiles] = useState<{ id: string; file: File }[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [attachError, setAttachError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logStatus, setLogStatus] = useState('');
  const [product, setProduct] = useState('');
  const [showLogHelp, setShowLogHelp] = useState(false);
  const logInputRef = useRef<HTMLInputElement>(null);
  const shotsRef = useRef<Shot[]>([]);

  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  // Release object URLs when the form unmounts.
  useEffect(() => {
    return () => shotsRef.current.forEach((shot) => URL.revokeObjectURL(shot.url));
  }, []);

  const totalBytes =
    shots.reduce((sum, shot) => sum + shot.file.size, 0) +
    files.reduce((sum, item) => sum + item.file.size, 0);

  function addScreenshots(incoming: File[]) {
    setAttachError('');
    const accepted: Shot[] = [];
    let running = totalBytes;
    let problem = '';

    for (const file of incoming) {
      if (!SCREENSHOT_TYPES.includes(file.type)) {
        problem = `"${file.name}" is not a supported screenshot. Use PNG, JPG, GIF, or WebP.`;
      } else if (file.size > MAX_FILE_BYTES) {
        problem = `"${file.name}" is larger than ${formatBytes(MAX_FILE_BYTES)}.`;
      } else if (shots.length + accepted.length >= MAX_SCREENSHOTS) {
        problem = `You can attach up to ${MAX_SCREENSHOTS} screenshots.`;
      } else if (running + file.size > MAX_TOTAL_BYTES) {
        problem = `Attachments can total at most ${formatBytes(MAX_TOTAL_BYTES)}.`;
      } else {
        running += file.size;
        accepted.push({ id: nextId(), file, url: URL.createObjectURL(file) });
      }
    }

    if (accepted.length) setShots((current) => [...current, ...accepted]);
    if (problem) setAttachError(problem);
  }

  function addFiles(incoming: File[]) {
    setAttachError('');
    const accepted: { id: string; file: File }[] = [];
    let running = totalBytes;
    let problem = '';

    for (const file of incoming) {
      if (BLOCKED_EXTENSIONS.has(fileExtension(file.name))) {
        problem = `"${file.name}" is an executable or script file type that cannot be attached.`;
      } else if (file.size > MAX_FILE_BYTES) {
        problem = `"${file.name}" is larger than ${formatBytes(MAX_FILE_BYTES)}.`;
      } else if (files.length + accepted.length >= MAX_FILES) {
        problem = `You can attach up to ${MAX_FILES} files.`;
      } else if (running + file.size > MAX_TOTAL_BYTES) {
        problem = `Attachments can total at most ${formatBytes(MAX_TOTAL_BYTES)}.`;
      } else {
        running += file.size;
        accepted.push({ id: nextId(), file });
      }
    }

    if (accepted.length) setFiles((current) => [...current, ...accepted]);
    if (problem) setAttachError(problem);
    return accepted.length;
  }

  function handleShotInput(event: ChangeEvent<HTMLInputElement>) {
    addScreenshots(Array.from(event.target.files || []));
    event.target.value = '';
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files || []));
    event.target.value = '';
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith('image/'),
    );

    if (pasted.length) {
      event.preventDefault();
      addScreenshots(pasted);
    }
  }

  // The Technowiz apps export a log bundle to the Desktop as
  // <ProductName>_<date-time>_log.zip. Browsers cannot read the disk silently, so
  // we open a file picker that starts on the Desktop and the user picks that zip.
  function handleLogFile(file: File | undefined) {
    if (!file) return;
    setLogStatus('');
    setAttachError('');

    if (!isLogExport(file.name, products, product)) {
      setShowLogHelp(true);
      setAttachError(
        `"${file.name}" is not a log export. Choose the file named ${logFileExample(product, products)}.`,
      );
      return;
    }

    if (addFiles([file]) > 0) {
      setShowLogHelp(false);
      setLogStatus(`Attached ${file.name}. Remove it below if you do not want to share it.`);
    }
  }

  async function handleGetLogs() {
    setLogStatus('');
    setAttachError('');
    setShowLogHelp(false);
    const showOpenFilePicker = (
      window as unknown as {
        showOpenFilePicker?: (
          options?: object,
        ) => Promise<{ getFile: () => Promise<File> }[]>;
      }
    ).showOpenFilePicker;

    if (!showOpenFilePicker) {
      logInputRef.current?.click();
      return;
    }

    try {
      const [handle] = await showOpenFilePicker.call(window, {
        id: 'support-log-export',
        startIn: 'desktop',
        multiple: false,
        types: [{ description: 'Log export (.zip)', accept: { 'application/zip': ['.zip'] } }],
      });
      handleLogFile(await handle?.getFile());
    } catch (pickError) {
      if (pickError instanceof DOMException && pickError.name === 'AbortError') {
        // Closed the dialog without picking: they may not have the file yet.
        setShowLogHelp(true);
        return;
      }
      // The API failed: fall back to the classic file dialog.
      logInputRef.current?.click();
    }
  }

  function handleLogInput(event: ChangeEvent<HTMLInputElement>) {
    handleLogFile(event.target.files?.[0]);
    event.target.value = '';
  }


  function removeShot(id: string) {
    setShots((current) => {
      const target = current.find((shot) => shot.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((shot) => shot.id !== id);
    });
    setAttachError('');
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id));
    setAttachError('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('');
    setError('');
    setIsSubmitting(true);

    const form = event.currentTarget;
    const fields = new FormData(form);
    const body = new FormData();

    for (const field of ['name', 'email', 'product', 'subject', 'message', 'website']) {
      body.set(field, String(fields.get(field) || '').trim());
    }

    shots.forEach((shot) => body.append('screenshots', shot.file, shot.file.name));
    files.forEach((item) => body.append('attachments', item.file, item.file.name));

    try {
      const response = await fetch('/api/get-support', { method: 'POST', body });
      const result = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(result?.message || 'Could not send your request.');
      }

      form.reset();
      shots.forEach((shot) => URL.revokeObjectURL(shot.url));
      setShots([]);
      setFiles([]);
      setAttachError('');
      setStatus('Request sent. Our support team will reply to your email ID.');
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : 'Could not send your request. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="contact-form support-form" onSubmit={handleSubmit}>
      <div className="contact-field-row">
        <div className="field-group">
          <label htmlFor={`${formId}-name`}>Your name</label>
          <input id={`${formId}-name`} name="name" type="text" autoComplete="name" required />
        </div>

        <div className="field-group">
          <label htmlFor={`${formId}-email`}>Email ID</label>
          <input
            id={`${formId}-email`}
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
      </div>

      <div className="field-group">
        <label htmlFor={`${formId}-product`}>Which product is this about?</label>
        <select id={`${formId}-product`} name="product"
          defaultValue=""
          required
          onChange={(event) => setProduct(event.target.value)}
        >
          <option value="" disabled>
            Select a product
          </option>
          {products.map((product) => (
            <option key={product} value={product}>
              {product}
            </option>
          ))}
          <option value={OTHER_PRODUCT}>Other / not sure</option>
        </select>
      </div>

      <div className="field-group">
        <label htmlFor={`${formId}-subject`}>What do you need help with?</label>
        <input
          id={`${formId}-subject`}
          name="subject"
          type="text"
          maxLength={150}
          placeholder="e.g. NoDupe stops at 80% while scanning an external drive"
          required
        />
      </div>

      <fieldset className="support-fieldset">
        <legend>Describe your issue</legend>

        <div className="field-group">
          <label htmlFor={`${formId}-message`}>What happened?</label>
          <textarea
            id={`${formId}-message`}
            name="message"
            rows={7}
            maxLength={MAX_MESSAGE}
            placeholder="Tell us what you were doing, what you expected, and what happened instead. Include the product, its version, and your Windows version if you can."
            onPaste={handlePaste}
            required
          />
          <p className="field-hint">Tip: paste a screenshot straight into this box.</p>
        </div>

        <div className="field-group">
          <span className="field-label">
            Screenshots{' '}
            <span className="field-optional">
              optional, up to {MAX_SCREENSHOTS}
            </span>
          </span>
          {shots.length ? (
            <ul className="shot-grid">
              {shots.map((shot) => (
                <li key={shot.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shot.url} alt={`Screenshot preview: ${shot.file.name}`} />
                  <span title={shot.file.name}>{shot.file.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${shot.file.name}`}
                    onClick={() => removeShot(shot.id)}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="file-picker">
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              onChange={handleShotInput}
            />
            <span>+ Add screenshots</span>
          </label>
        </div>

        <div className="field-group">
          <span className="field-label">
            Files{' '}
            <span className="field-optional">
              optional, logs, documents, or the file that fails, up to {MAX_FILES}
            </span>
          </span>
          {files.length ? (
            <ul className="file-list">
              {files.map((item) => (
                <li key={item.id}>
                  <span title={item.file.name}>{item.file.name}</span>
                  <small>{formatBytes(item.file.size)}</small>
                  <button
                    type="button"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removeFile(item.id)}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="file-picker-row">
            <label className="file-picker">
              <input type="file" multiple onChange={handleFileInput} />
              <span>+ Add files</span>
            </label>
            <button
              className="file-picker file-picker-logs"
              type="button"
              onClick={handleGetLogs}
            >
              Get logs
            </button>
            <input
              ref={logInputRef}
              className="visually-hidden-input"
              type="file"
              accept=".zip,application/zip"
              tabIndex={-1}
              aria-hidden="true"
              onChange={handleLogInput}
            />
          </div>
          <p className="field-hint">
            Get logs: export the logs from the app first. It saves{' '}
            <code>{logFileExample(product, products)}</code> to your Desktop
            {products.includes(product) ? '' : ' (select a product above to see its exact file name)'}
            . Click <strong>Get logs</strong> and pick that file. The logs hold file names,
            never file contents.
          </p>
          {showLogHelp ? (
            <div className="log-help-tip" role="status">
              <strong>Can&apos;t find the log file?</strong>
              <p>
                In the app, click <strong>Settings</strong>, scroll to the end, find{' '}
                <strong>&quot;Export Logs&quot;</strong> and click it. It saves the log file to
                your Desktop. Then click <strong>Get logs</strong> again and pick that file.
              </p>
              <button
                type="button"
                aria-label="Dismiss tip"
                onClick={() => setShowLogHelp(false)}
              >
                &times;
              </button>
            </div>
          ) : null}
          {logStatus ? (
            <p className="form-status" role="status">
              {logStatus}
            </p>
          ) : null}
        </div>

        <p className="field-hint">
          {formatBytes(totalBytes)} of {formatBytes(MAX_TOTAL_BYTES)} used. Up to{' '}
          {formatBytes(MAX_FILE_BYTES)} per file. Executable and script files are not accepted.
        </p>
        {attachError ? <p className="form-error">{attachError}</p> : null}
      </fieldset>

      <div className="hidden-field" aria-hidden="true">
        <label htmlFor={`${formId}-website`}>Website</label>
        <input id={`${formId}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="contact-form-actions">
        <button className="button primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending...' : 'Send to support'}
        </button>
      </div>
      {status ? (
        <p className="form-status" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

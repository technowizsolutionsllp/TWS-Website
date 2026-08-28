'use client';

import { FormEvent, ReactNode, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { services } from './company-data';

type ContactPopupProps = {
  triggerLabel?: string;
  triggerClassName?: string;
  children?: ReactNode;
};

export default function ContactPopup({
  triggerLabel = 'Contact us',
  triggerClassName = 'button primary',
  children,
}: ContactPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('');
    setError('');
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const service = String(formData.get('service') || '').trim();
    const message = String(formData.get('message') || '').trim();
    const website = String(formData.get('website') || '').trim();

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, email, service, message, website }),
      });
      const result = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;

      if (!response.ok) {
        throw new Error(result?.message || 'Could not send the message.');
      }

      event.currentTarget.reset();
      setStatus('Message sent. We will reply by email.');
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : 'Could not send the message. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const modal =
    isOpen && typeof document !== 'undefined'
      ? createPortal(
        <div
          className="contact-modal-backdrop"
          role="presentation"
          onMouseDown={() => setIsOpen(false)}
        >
          <section
            className="contact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${formId}-title`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="contact-modal-head">
              <div>
                <p className="eyebrow">Contact Technowiz Solutions</p>
                <h2 id={`${formId}-title`}>Tell us what you want to build or improve.</h2>
              </div>
              <button
                className="modal-close"
                type="button"
                aria-label="Close contact form"
                onClick={() => setIsOpen(false)}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>

            <div className="contact-modal-body">
              <form className="contact-form" onSubmit={handleSubmit}>
                <p className="contact-form-intro">
                  Share the business context, current process, and what a better
                  outcome should look like. We will review it and respond with the
                  right next step.
                </p>

                <div className="contact-field-row">
                  <div className="field-group">
                    <label htmlFor={`${formId}-name`}>Name</label>
                    <input
                      id={`${formId}-name`}
                      name="name"
                      type="text"
                      autoComplete="name"
                      required
                    />
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
                  <label htmlFor={`${formId}-service`}>Service interest</label>
                  <select id={`${formId}-service`} name="service" defaultValue="">
                    <option value="">Choose a service area, optional</option>
                    {services.map((service) => (
                      <option key={service.title} value={service.title}>
                        {service.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-group">
                  <label htmlFor={`${formId}-message`}>Message</label>
                  <textarea
                    id={`${formId}-message`}
                    name="message"
                    rows={6}
                    placeholder="Briefly describe the project, workflow, product idea, or operational problem."
                    required
                  />
                </div>

                <div className="hidden-field" aria-hidden="true">
                  <label htmlFor={`${formId}-website`}>Website</label>
                  <input id={`${formId}-website`} name="website" type="text" tabIndex={-1} />
                </div>

                <div className="contact-form-actions">
                  <button className="button primary" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Sending...' : 'Send request'}
                  </button>
                </div>
                {status ? <p className="form-status">{status}</p> : null}
                {error ? <p className="form-error">{error}</p> : null}
              </form>

              <div className="contact-next-steps" aria-label="What happens next">
                <article>
                  <span>01</span>
                  <p>We understand the current workflow and business context.</p>
                </article>
                <article>
                  <span>02</span>
                  <p>We identify the right starting point for the work.</p>
                </article>
                <article>
                  <span>03</span>
                  <p>We suggest a focused first release or a scope discussion.</p>
                </article>
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )
      : null;

  return (
    <>
      <button className={triggerClassName} type="button" onClick={() => setIsOpen(true)}>
        {children || triggerLabel}
      </button>
      {modal}
    </>
  );
}

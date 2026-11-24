// The retention job as a Worker of its own (tws-retention), run daily by a Cron Trigger.
//
// It applies the periods stated in the privacy notices to both products' databases: trial name and email erased 24 months
// after the last contact, trial records deleted after 5 years, telemetry events deleted after 24 months (see
// docs/RETENTION.md). It answers no HTTP requests, holds no secrets and reads no personal data: the statements only
// compare timestamps. A failure for either product makes the run fail, so it shows as failed in the Cloudflare dashboard
// and the website's Health check warns when old data remains.

import { runRetention, type RetentionEnv } from '../../lib/retention/run';

export default {
  async fetch(): Promise<Response> {
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  },

  async scheduled(controller: ScheduledController, env: RetentionEnv): Promise<void> {
    const reports = await runRetention(env, Math.floor(controller.scheduledTime / 1000));
    console.log(JSON.stringify({ svc: 'retention', reports }));
    const failed = reports.filter((r) => !r.ok);
    if (failed.length > 0) throw new Error(`retention failed for: ${failed.map((r) => r.product).join(', ')}`);
  },
} satisfies ExportedHandler<RetentionEnv>;

import express from 'express';

export function createApp({ intake }) {
  const app = express();
  app.disable('x-powered-by');

  app.post(
    '/webhooks/github',
    express.raw({
      type: 'application/json',
      limit: '1mb',
      inflate: false,
    }),
    async (req, res, next) => {
      try {
        if (!req.is('application/json')) {
          return res.status(415).json({
            error: 'content_type_must_be_application_json',
          });
        }

        const result = await intake({
          rawBody: Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.alloc(0),
          signature: req.get('x-hub-signature-256'),
          eventName: req.get('x-github-event'),
          traceId: req.get('x-github-delivery'),
        });

        return res.status(result.statusCode).json(result.body);
      } catch (error) {
        next(error);
      }
    },
  );

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload_too_large' });
    }

    if (error.status === 415) {
      return res.status(415).json({ error: 'unsupported_encoding' });
    }

    if (error.status === 400) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    console.error(JSON.stringify({
      svc: 'webhook',
      stage: 'http',
      msg: 'unexpected_error',
    }));

    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

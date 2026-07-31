const express = require('express');

function createPostgresPaymentRouter({ paymentService } = {}) {
  if (!paymentService?.processEasyPayCallback) throw new TypeError('PostgreSQL payment service is required');
  const router = express.Router();
  const notify = async (req, res) => {
    try {
      await paymentService.processEasyPayCallback({ ...(req.query || {}), ...(req.body || {}) });
      return res.type('text/plain').send('success');
    } catch (error) {
      return res.status(error.status || 500).type('text/plain').send('fail');
    }
  };
  router.get('/easypay/notify', notify);
  router.post('/easypay/notify', notify);
  return router;
}

module.exports = { createPostgresPaymentRouter };

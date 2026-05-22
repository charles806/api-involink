Backend Developer Prompt
---
We need you to implement Paystack payment integration on the backend.
Required Endpoints
1. Initialize Payment
POST /api/payments/initialize
Headers: Authorization: Bearer <token>
Body: { 
  "invoiceId": "invoice_123", 
  "email": "customer@example.com" 
}
Response: { 
  "reference": "PAYSTACK_REFERENCE", 
  "amount": 50000 
}
- Create a Paystack transaction using your secret key
- Store reference in database linked to invoice
- Return the Paystack reference to frontend
2. Verify Payment
GET /api/payments/verify/:reference
Response: { 
  "success": true, 
  "message": "Payment verified",
  "data": { ... }
}
- Verify transaction status with Paystack API
- If successful, update invoice status to "paid"
- Return verification result
Environment Variables Needed
PAYSTACK_SECRET_KEY=sk_test_your_key
PAYSTACK_WEBHOOK_SECRET=whsec_your_webhook_secret
Webhook (Important)
Create a webhook endpoint to receive payment notifications from Paystack:
POST /api/webhooks/paystack
- Verify the webhook signature
- Update invoice to "paid" when payment succeeds
Implementation Notes
- Use Paystack Node.js SDK: npm install @paystack/paystack-sdk
- Amount is in kobo (multiply Naira by 100)
- Test with Paystack test keys before production
---
Let me know when the backend is ready and I'll connect it to the frontend!
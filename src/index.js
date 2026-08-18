import express, { json, urlencoded } from "express";
import dotenv from "dotenv";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import clientRoutes from "./routes/clients.js";
import invoiceRoutes from "./routes/invoices.js";
import paymentRoutes from "./routes/payments.js";
import subscriptionRoutes from "./routes/subscriptions.js";
import dashboardRoutes from "./routes/dashboard.js";
import settingsRoutes from "./routes/settings.js";
import webhookRoutes from "./routes/webhooks.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT;

// CORS — restrict in production
const allowedOrigins = (process.env.FRONTEND_URL)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, mobile apps, etc.)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

// Webhook route MUST come before express.json() — Paystack sends raw body
app.use("/api/webhooks", webhookRoutes);

// Body parsing with size limits
app.use(json({ limit: "10kb" }));
app.use(urlencoded({ extended: true, limit: "10kb" }));

// Simple request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.path !== "/api/health") {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});
app.get("/", (req, res) => {
  res.json({ message: "Wagwan", timestamp: new Date().toISOString() });
});
// Routes
app.use("/api/auth", authRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/settings", settingsRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message || err);

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "CORS: Origin not allowed" });
  }

  // JSON parse errors
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }

  // Body too large
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }

  res.status(500).json({ error: "Internal server error" });
});

// Graceful shutdown
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

// Only listen in local development, export for Vercel serverless
if (
  process.env.NODE_ENV !== "production" &&
  process.env.NODE_ENV !== "test" &&
  !process.env.VERCEL
) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;

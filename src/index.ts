import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./db.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDailyReportRoutes } from "./routes/daily-reports.js";
import { registerTripLegRoutes } from "./routes/trip-legs.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerAttendanceRoutes } from "./routes/attendance.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerDispatchRoutes } from "./routes/dispatch.js";
import { registerDocumentsRoutes } from "./routes/documents.js";
import { registerComplaintsRoutes } from "./routes/complaints.js";
import { registerInstructionRecordsRoutes } from "./routes/instruction-records.js";
import { registerLiffBookingRoutes } from "./routes/liff-booking.js";
import { registerPublicBookingRoutes } from "./routes/public-booking.js";
import { registerEmployeeInviteRoutes } from "./routes/employee-invite.js";
import { registerPublicInquiryRoutes } from "./routes/public-inquiry.js";
import { registerPlatformRoutes } from "./routes/platform.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerBillingWebhook } from "./routes/billing-webhook.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

/** CORS: LIFF から API を呼ぶ場合は CORS_ALLOWED_ORIGINS に LINE のオリジン（例: https://liff.line.me,https://miniapp.line.me）を追加。未設定かつ本番以外は origin: true。 */
const origins = process.env.CORS_ALLOWED_ORIGINS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: origins?.length ? origins : true,
  credentials: true,
});

const helmetOpts =
  process.env.NODE_ENV === "production"
    ? {
        global: true as const,
        contentSecurityPolicy: {
          useDefaults: false,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://cdn.tailwindcss.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
            frameSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
          },
        },
      }
    : { global: true as const, contentSecurityPolicy: false };

await app.register(helmet, helmetOpts);
await app.register(jwt, {
  secret: process.env.JWT_SECRET || "daiko-dev-secret-change-me-min-32-chars!!",
});

await app.register(swagger, {
  openapi: {
    openapi: "3.0.3",
    info: { title: "Daiko API", version: "0.3.0-skeleton", description: "認証のみの再構築ベース" },
    servers: process.env.PUBLIC_API_BASE
      ? [{ url: process.env.PUBLIC_API_BASE }]
      : [{ url: "http://127.0.0.1:3001/api/v1" }],
  },
});

if (process.env.OPENAPI_UI === "1" || process.env.NODE_ENV !== "production") {
  await app.register(swaggerUi, {
    routePrefix: "/api/v1/docs",
    uiConfig: { docExpansion: "list", deepLinking: false },
  });
}

app.get("/health", async () => ({ ok: true, service: "daiko" }));

/** ルートは API より先に登録 */
app.get("/app", async (_, reply) => reply.redirect("/app/", 302));
app.get("/app/demo", async (_, reply) => reply.redirect("/app/", 302));
app.get("/web", async (_, reply) => reply.redirect("/app/", 302));

const lpStaticRoot = join(__dirname, "../public/lp");
app.get("/", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("index.html", lpStaticRoot);
});
await app.register(fastifyStatic, {
  root: lpStaticRoot,
  prefix: "/lp/",
  decorateReply: false,
});

const publicAssetsRoot = join(__dirname, "../public");
await app.register(fastifyStatic, {
  root: join(publicAssetsRoot, "images"),
  prefix: "/images/",
  decorateReply: false,
});
app.get("/favicon.ico", async (_, reply) => {
  return reply.sendFile("favicon.ico", publicAssetsRoot);
});
app.get("/robots.txt", async (_, reply) => {
  return reply.type("text/plain; charset=utf-8").sendFile("robots.txt", publicAssetsRoot);
});
app.get("/sitemap.xml", async (_, reply) => {
  return reply.type("application/xml; charset=utf-8").sendFile("sitemap.xml", publicAssetsRoot);
});
app.get("/googlea48fb01297c4ced2.html", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("googlea48fb01297c4ced2.html", publicAssetsRoot);
});
app.get("/portal", async (_, reply) => reply.redirect("/portal/", 302));
app.get("/portal/", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("portal/index.html", publicAssetsRoot);
});

const legalPages: Record<string, string> = {
  "/legal/tokushoho": "legal/tokushoho.html",
  "/legal/privacy": "legal/privacy.html",
  "/legal/terms": "legal/terms.html",
};

app.get("/report", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("report.html", lpStaticRoot);
});
app.get("/blog", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("blog/index.html", lpStaticRoot);
});
app.get("/blog/police-audit", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("blog/police-audit.html", lpStaticRoot);
});
app.get("/blog/payroll-calculation", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("blog/payroll-calculation.html", lpStaticRoot);
});
app.get("/blog/dispatch-efficiency", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("blog/dispatch-efficiency.html", lpStaticRoot);
});
app.get("/blog/driver-recruitment", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("blog/driver-recruitment.html", lpStaticRoot);
});
app.get("/blog/google-maps-seo", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("blog/google-maps-seo.html", lpStaticRoot);
});
app.get("/blog/easy-for-everyone", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("blog/easy-for-everyone.html", lpStaticRoot);
});
app.get("/blog/multi-store-management", async (_, reply) => {
  return reply.type("text/html; charset=utf-8").sendFile("blog/multi-store-management.html", lpStaticRoot);
});
for (const [route, file] of Object.entries(legalPages)) {
  app.get(route, async (_, reply) => {
    return reply.type("text/html; charset=utf-8").sendFile(file, lpStaticRoot);
  });
}

const v1 = "/api/v1";
await app.register(registerAuthRoutes, { prefix: v1 });
await app.register(registerBillingWebhook, { prefix: `${v1}/billing` });
await app.register(registerBillingRoutes, { prefix: `${v1}/billing` });
await app.register(registerSettingsRoutes, { prefix: `${v1}/settings` });
await app.register(registerAttendanceRoutes, { prefix: `${v1}/attendance` });
await app.register(registerDailyReportRoutes, { prefix: v1 });
await app.register(registerTripLegRoutes, { prefix: v1 });
await app.register(registerDashboardRoutes, { prefix: `${v1}/dashboard` });
await app.register(registerDispatchRoutes, { prefix: `${v1}/dispatch` });
await app.register(registerLiffBookingRoutes, { prefix: `${v1}/liff` });
await app.register(registerPublicBookingRoutes, { prefix: `${v1}/public` });
await app.register(registerEmployeeInviteRoutes, { prefix: `${v1}/public` });
await app.register(registerPublicInquiryRoutes, { prefix: `${v1}/public` });
await app.register(registerPlatformRoutes, { prefix: `${v1}/platform` });
await app.register(registerInstructionRecordsRoutes, { prefix: `${v1}/instruction-records` });
await app.register(registerComplaintsRoutes, { prefix: `${v1}/complaints` });
await app.register(registerDocumentsRoutes, { prefix: v1 });

app.get("/api/v1/openapi.json", async () => app.swagger());

const appStaticRoot = join(__dirname, "../public/app");
await app.register(fastifyStatic, {
  root: appStaticRoot,
  prefix: "/app/",
});

app.setNotFoundHandler((req, reply) => {
  const raw = req.raw.url ?? "";
  const pathOnly = raw.split("?")[0] ?? "";
  if (
    req.method === "GET" &&
    (pathOnly === "/app" || (pathOnly.startsWith("/app/") && !pathOnly.startsWith("/app/assets/")))
  ) {
    return reply.type("text/html; charset=utf-8").sendFile("index.html", appStaticRoot);
  }
  void reply.code(404).send({ error: "not found" });
});

const port = Number(process.env.PORT || 3001);
await app.listen({ port, host: "0.0.0.0" });
app.log.info({ port }, "daiko listening");

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

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
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerAttendanceRoutes } from "./routes/attendance.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerDispatchRoutes } from "./routes/dispatch.js";
import { registerDocumentsRoutes } from "./routes/documents.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

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
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "data:"],
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

/** ルートは API より先に登録（本番でトップが 404 にならないよう明示的に） */
app.get("/app", async (_, reply) => reply.redirect("/app/", 302));
app.get("/", async (_, reply) => reply.redirect("/app/", 302));
app.get("/web", async (_, reply) => reply.redirect("/app/", 302));

const v1 = "/api/v1";
await app.register(registerAuthRoutes, { prefix: v1 });
await app.register(registerSettingsRoutes, { prefix: `${v1}/settings` });
await app.register(registerAttendanceRoutes, { prefix: `${v1}/attendance` });
await app.register(registerDailyReportRoutes, { prefix: v1 });
await app.register(registerDashboardRoutes, { prefix: `${v1}/dashboard` });
await app.register(registerDispatchRoutes, { prefix: `${v1}/dispatch` });
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

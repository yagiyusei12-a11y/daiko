import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Stripe Webhook 署名検証用（JSON パース前のバッファ） */
    rawBody?: Buffer;
  }
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  generateAndStoreLicenseKeys,
  parseGenerateQuantity,
  parseValidDays,
} from "../lib/license-key.js";

export async function registerPlatformLicenseRoutes(app: FastifyInstance): Promise<void> {
  app.post("/license/generate", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      validDays?: unknown;
      quantity?: unknown;
      note?: unknown;
      batchLabel?: unknown;
    };

    const validDays = parseValidDays(body.validDays);
    if (validDays === null) {
      return reply.code(400).send({ error: "validDays must be an integer between 1 and 3650" });
    }

    const quantity = parseGenerateQuantity(body.quantity);
    if (quantity === null) {
      return reply.code(400).send({ error: "quantity must be an integer between 1 and 100" });
    }

    const note = body.note !== undefined && body.note !== null ? String(body.note).trim() : null;
    const batchLabel =
      body.batchLabel !== undefined && body.batchLabel !== null
        ? String(body.batchLabel).trim() || null
        : null;

    try {
      const result = await generateAndStoreLicenseKeys({
        validDays,
        quantity,
        note: note || null,
        batchLabel,
      });

      return {
        keys: result.keys,
        validDays,
        quantity,
        batchLabel: result.batchLabel,
        note: note || null,
      };
    } catch (err) {
      req.log.error({ err }, "license key generation failed");
      return reply.code(500).send({ error: "Failed to generate license keys" });
    }
  });
}

import type { Logger, MedusaRequest, MedusaResponse } from "@medusajs/medusa";
import { PaymentProviderRepository } from "@medusajs/medusa/dist/repositories/payment-provider";
import { EntityManager } from "typeorm";
import { HyperswitchSettings } from "src/models/payment-provider";
import { MedusaError } from "medusa-core-utils";

export const GET = (req: MedusaRequest, res: MedusaResponse) => {
  res.json({
    message: "Hyperswitch Settings Update Service",
  });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.body as HyperswitchSettings;
  if (!body.api_key || !body.webhook_response_hash) {
    return res.status(400).json({ message: "Invalid body" });
  }

  const container = req.scope;
  const paymentRepo = container.resolve("paymentProviderRepository");
  const logger = container.resolve("logger") as Logger;
  const manager = container.resolve("manager") as EntityManager;

  const ppRepo = manager.withRepository(
    paymentRepo
  ) as typeof PaymentProviderRepository;

  let qq: any;
  try {
    qq = await ppRepo.update({ id: "hyperswitch" }, {
      settings: JSON.stringify({
        api_key: body.api_key,
        webhook_response_hash: body.webhook_response_hash,
      }),
    } as any);
  } catch (error) {
    logger.error(
      `[Hyperswitch Settings]: Unable to update the Settings ${error} - Body ${body}`
    );
  }

  if (qq) {
    return res.status(200).json({ message: "Updated successfully!" });
  }

  return res.status(500).json({ message: "Unknow error happened" });
};

import type { MedusaRequest, MedusaResponse } from "@medusajs/medusa";
import hyperswitch from "./hyperswitch";

export const GET = (req: MedusaRequest, res: MedusaResponse) => {
  res.json({
    message: "Hyperswitch Webhook Service",
  });
};

export const POST = (req: MedusaRequest, res: MedusaResponse) => {
  return hyperswitch(req, res);
};

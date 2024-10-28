import type { MedusaRequest, MedusaResponse } from "@medusajs/medusa";

const PAYMENT_SERVICE_KEY = "pp_hyperswitch";

export const GET = (req: MedusaRequest, res: MedusaResponse) => {
  const paymentService = req.scope.resolve(PAYMENT_SERVICE_KEY);
  res.json({
    message: "[GET] Hello world!",
  });
};

export const POST = (req: MedusaRequest, res: MedusaResponse) => {
  res.json({
    message: "[POST] Hello world!",
  });
};

export const CORS = false;

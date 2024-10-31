import { Request, Response } from "express";
import { constructWebhook, handlePaymentHook } from "../../util";

export default async (req: Request, res: Response) => {
  let event: any;
  try {
    event = constructWebhook({
      signature: req.headers["x-webhook-signature-512"],
      body: req.body,
      container: req.scope,
    });
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }
  const paymentIntent = event.content.object;

  const { statusCode } = await handlePaymentHook({
    event,
    container: req.scope,
    paymentIntent,
  });
  res.sendStatus(statusCode);
};

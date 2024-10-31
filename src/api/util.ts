import Stripe from "@juspay-tech/hyper-node";
import {
  AbstractCartCompletionStrategy,
  CartService,
  IdempotencyKeyService,
  Logger,
  PostgresError,
} from "@medusajs/medusa";
import { AwilixContainer } from "awilix";
import { MedusaError } from "medusa-core-utils";
import { EOL } from "os";

const PAYMENT_PROVIDER_KEY = "pp_hyperswitch";

export function constructWebhook({
  signature,
  body,
  container,
}: {
  signature: string | string[] | undefined;
  body: any;
  container: AwilixContainer;
}): Stripe.Event {
  const hyperswitchProviderService = container.resolve(PAYMENT_PROVIDER_KEY);
  return hyperswitchProviderService.constructWebhookEvent(body, signature);
}

export function isPaymentCollection(id: string) {
  return id && id.startsWith("paycol");
}

export function buildError(event: string, err: Stripe.StripeRawError): string {
  let message = `Hyperswitch webhook ${event} handling failed${EOL}${
    err?.detail ?? err?.message
  }`;
  if (err?.code === PostgresError.SERIALIZATION_FAILURE) {
    message = `Hyperswitch webhook ${event} handle failed. This can happen when this webhook is triggered during a cart completion and can be ignored. This event should be retried automatically.${EOL}${
      err?.detail ?? err?.message
    }`;
  }
  if (err?.code === "409") {
    message = `Hyperswitch webhook ${event} handle failed.${EOL}${
      err?.detail ?? err?.message
    }`;
  }

  return message;
}

export async function handlePaymentHook({
  event,
  container,
  paymentIntent,
}: {
  event: { event_type: string; event_id: string };
  container: AwilixContainer;
  paymentIntent: {
    payment_id: string;
    metadata: { cart_id?: string; resource_id?: string };
    last_payment_error?: { message: string };
  };
}): Promise<{ statusCode: number }> {
  const logger: Logger = container.resolve("logger");

  const cartId =
    paymentIntent.metadata.cart_id ?? paymentIntent.metadata.resource_id; // Backward compatibility
  const resourceId = paymentIntent.metadata.resource_id;

  switch (event.event_type) {
    case "payment_succeeded":
      logger.info(`[Hypersiwtch] - Webhook event ${event.event_type}`);
      try {
        await onPaymentIntentSucceeded({
          eventId: event.event_id,
          paymentIntent,
          cartId,
          resourceId,
          isPaymentCollection: isPaymentCollection(resourceId),
          container,
        });
      } catch (err) {
        const message = buildError(event.event_type, err);
        logger.info(`Webhook Error: ${err} - ${message}`);
        return { statusCode: 409 };
      }

      break;
    case "payment_failed": {
      const message =
        paymentIntent.last_payment_error &&
        paymentIntent.last_payment_error.message;
      logger.error(
        `The payment of the payment intent ${paymentIntent.payment_id} has failed${EOL}${message}`
      );
      break;
    }
    default:
      return { statusCode: 204 };
  }

  return { statusCode: 200 };
}

async function onPaymentIntentSucceeded({
  eventId,
  paymentIntent,
  cartId,
  resourceId,
  isPaymentCollection,
  container,
}) {
  const manager = container.resolve("manager");

  await manager.transaction(async (transactionManager) => {
    if (isPaymentCollection) {
      await capturePaymenCollectiontIfNecessary({
        paymentIntent,
        resourceId,
        container,
      });
    } else {
      await capturePaymentIfNecessary({
        cartId,
        transactionManager,
        container,
      });
    }
  });
}

async function onPaymentAmountCapturableUpdate({ eventId, cartId, container }) {
  const manager = container.resolve("manager");

  await manager.transaction(async (transactionManager) => {
    await completeCartIfNecessary({
      eventId,
      cartId,
      container,
      transactionManager,
    });
  });
}

async function capturePaymenCollectiontIfNecessary({
  paymentIntent,
  resourceId,
  container,
}) {
  const manager = container.resolve("manager");
  const paymentCollectionService = container.resolve(
    "paymentCollectionService"
  );

  const paycol = await paymentCollectionService
    .retrieve(resourceId, { relations: ["payments"] })
    .catch(() => undefined);

  if (paycol?.payments?.length) {
    const payment = paycol.payments.find(
      (pay) => pay.data.id === paymentIntent.payment_id
    );

    if (payment && !payment.captured_at) {
      await manager.transaction(async (manager) => {
        await paymentCollectionService
          .withTransaction(manager)
          .capture(payment.payment_id);
      });
    }
  }
}

async function capturePaymentIfNecessary({
  cartId,
  transactionManager,
  container,
}) {
  const orderService = container.resolve("orderService");
  let order = await orderService
    .retrieveByCartId(cartId)
    .catch(() => undefined);

  // Might be undefined with the latency, so sleeping could return result
  if (!order) {
    await new Promise((r) => setTimeout(r, 2000));
  }

  order = await orderService.retrieveByCartId(cartId).catch(() => undefined);

  const logger = container.resolve("logger") as Logger;

  logger.info(
    `[Hyperswitch Webhook] - Order data with ${order?.id} with Cart ${cartId}`
  );

  if (order?.payment_status !== "captured") {
    await orderService
      .withTransaction(transactionManager)
      .capturePayment(order.id);
  }
}

async function completeCartIfNecessary({
  eventId,
  cartId,
  container,
  transactionManager,
}) {
  const orderService = container.resolve("orderService");
  const loggerService: Logger = container.resolve("logger");
  const order = await orderService
    .retrieveByCartId(cartId)
    .catch(() => undefined);

  if (!order) {
    const completionStrat: AbstractCartCompletionStrategy = container.resolve(
      "cartCompletionStrategy"
    );
    const cartService: CartService = container.resolve("cartService");
    const idempotencyKeyService: IdempotencyKeyService = container.resolve(
      "idempotencyKeyService"
    );

    const cart = await cartService
      .withTransaction(transactionManager)
      .retrieve(cartId, {
        select: ["context", "completed_at", "payment_authorized_at"],
      });

    if (cart.completed_at && cart.payment_authorized_at) {
      return;
    }

    const idempotencyKeyServiceTx =
      idempotencyKeyService.withTransaction(transactionManager);
    let idempotencyKey: any;
    try {
      idempotencyKey = await idempotencyKeyServiceTx.retrieve({
        request_path: "/hyperswitch/hooks",
        idempotency_key: eventId,
      });
      loggerService.info(`[Webhook]: idempotencyKey Fetch - ${idempotencyKey}`);
    } catch (err) {
      loggerService.info("[Webhook]: Failed idempotencyKey");
    }

    if (!idempotencyKey) {
      loggerService.info("[Webhook]: Creating idempotencyKey");
      idempotencyKey = await idempotencyKeyService
        .withTransaction(transactionManager)
        .create({
          request_path: "/hyperswitch/hooks",
          idempotency_key: eventId,
        });
    }

    const { response_code, response_body } = await completionStrat
      .withTransaction(transactionManager)
      .complete(cartId, idempotencyKey, { ip: cart.context?.ip as string });

    if (response_code !== 200) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        response_body["message"] as string,
        response_body["code"] as string
      );
    }
  }
}

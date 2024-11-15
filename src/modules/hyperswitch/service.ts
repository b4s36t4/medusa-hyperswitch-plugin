// @ts-ignore
import Stripe from "@juspay-tech/hyper-node";
// @ts-ignore
import HyperSwitch from "@juspay-tech/hyperswitch-node";
import parsePhoneNumber from "libphonenumber-js";
import {
  AbstractPaymentProvider,
  isPaymentProviderError,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils";
import { Logger } from "@medusajs/medusa";
import {
  PaymentProviderError,
  PaymentProviderSessionResponse,
  CreatePaymentProviderSession,
  UpdatePaymentProviderSession,
  ProviderWebhookPayload,
  WebhookActionResult,
  ICustomerModuleService,
  ConfigModule,
} from "@medusajs/types";
import { getAmountFromSmallestUnit, getSmallestUnit } from "../utils/amount";
import { AwilixContainer } from "awilix";
import { updateCustomer } from "../../workflows/customer";
import { createHmac } from "crypto";
import { updateRefund } from "../../workflows/refund";

type InjectedDependencies = {
  logger: Logger;
  configModule: ConfigModule;
} & Record<string, any>;

type WebhookEvent =
  | "payment_succeeded"
  | "payment_failed"
  | "payment_cancelled"
  | "payment_authorized"
  | "payment_captured"
  | "action_required"
  | "refund_succeeded"
  | "refund_failed";

type Options = {
  apiKey: string;
  sandbox?: boolean;
  webhook_key: string;
  capture_method?: "automatic" | "manual";
  allowed_payment_method_types?: string;
  profile_id?: string;
};

class MyPaymentProviderService extends AbstractPaymentProvider<Options> {
  static identifier = "hyperswitch";

  protected options: Options | null = null;
  protected hyperswitch: Stripe | null = null;
  protected logger: Logger;
  protected customerService: ICustomerModuleService;
  protected host: string;

  constructor(container: AwilixContainer, options: Options) {
    // @ts-ignore
    super(...arguments);
    this.options = options;

    this.logger = (container as any).logger;
    // this.customerService = customer;

    // console.log(logger, "loggg");

    this.logger.info(`[Hyperswitch]: Module Init`);
  }

  validateOptions(options: Options) {
    if (!options.apiKey || !options.webhook_key) {
      this.logger.error(`[Hyperswitch]: Invalid Options passed to module`);
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Invalid Options Passed to module"
      );
    }
  }

  // Client Abstraction
  protected async getClient() {
    if (this.hyperswitch) {
      return this.hyperswitch;
    }
    this.logger.info(`[Hyperswitch]: Initializing Client`);
    this.host = !this.options?.sandbox
      ? "api.hyperswitch.io"
      : "sandbox.hyperswitch.io";

    this.hyperswitch = new HyperSwitch(this.options.apiKey, {
      host: this.host,
    });

    return this.hyperswitch;
  }

  async capturePayment(
    paymentData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    this.logger.error(`[Hyperswitch]: Capture Payment Start`);
    const client = await this.getClient();
    if (!client) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to load Hyperswitch module"
      );
    }
    const paymentId = paymentData.payment_id as string;
    const paymentInfo = await client.paymentIntents.retrieve(paymentId);
    // We don't need to mark the payment `capture` if the status is already `succeeded`
    if (
      paymentInfo.status === "succeeded" ||
      this.options?.capture_method === "automatic"
    ) {
      this.logger.info(
        `[Hyperswitch]: - Payment status is ${paymentInfo.status} - No need to capture`
      );
      return {...paymentInfo, id: (paymentInfo as any).payment_id} as unknown as PaymentProviderSessionResponse["data"];
    }
    try {
      const intent = await client.paymentIntents.capture(paymentId);
      this.logger.info(
        `[Hyperswitch]: Payment Captured with id - ${paymentId}`
      );
      return {...intent, id: (intent as any).payment_id} as unknown as PaymentProviderSessionResponse["data"];
    } catch (error) {
      this.logger.error(error);
      return { error: "unknow error happened" };
    }
  }
  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<
    | PaymentProviderError
    | {
        status: PaymentSessionStatus;
        data: PaymentProviderSessionResponse["data"];
      }
  > {
    this.logger.info(`[Hyperswitch]: Authorize Payment Start`);
    const client = await this.getClient();
    if (!client) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to load Hyperswitch module"
      );
    }
    try {
      const status = await this.getPaymentStatus(paymentSessionData);
      this.logger.info(`[Hyperswitch]: Authorize Payment Success`);
      return { data: paymentSessionData, status };
    } catch (error) {
      this.logger.error(
        `[Hyperswitch]: Authorize Payment Failed - ${JSON.stringify(error)}`
      );
      return { error: "Payment authorization failed" };
    }
  }
  async cancelPayment(
    paymentData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    this.logger.info(`[Hyperswitch]: Cancel Payment Start`);
    const client = await this.getClient();
    if (!client) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to load Hyperswitch module"
      );
    }

    try {
      const paymentId = (await paymentData.payment_id) as string;
      const cancelIntent = await client.paymentIntents.cancel(paymentId);
      this.logger.info(`[Hyperswitch]: Cancel Payment Successful`);
      return {...cancelIntent, id: (cancelIntent as any).payment_id} as unknown as PaymentProviderSessionResponse["data"];
    } catch (error) {
      // Payment is already cancelled, keep the payment Data in DB as is
      if (
        error instanceof this.hyperswitch.errors.StripeError &&
        error.payment_intent.status === "canceled"
      ) {
        return error.payment_intent as unknown as PaymentProviderSessionResponse["data"];
      }

      this.logger.error(`[Hyperswitch]: Unable to Cancel Payment`);

      return { error: "Unable to cancel Payment" };
    }
  }
  async initiatePayment(
    context: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const client = await this.getClient();
    if (!client) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to load Hyperswitch module"
      );
    }
    const { amount, currency_code } = context;
    const {
      email,
      customer,
      session_id,
      extra,
      billing_address = {},
    } = context.context;

    const description = extra?.payment_description ?? "";

    const parsedPhone = parsePhoneNumber(billing_address?.phone ?? "");
    const intentBody: Stripe.PaymentIntentCreateParams = {
      amount: getSmallestUnit(amount, currency_code),
      description: description as string,
      currency: currency_code.toUpperCase(),
      // Allowed Payment Method types
      allowed_payment_method_types:
        this.options?.allowed_payment_method_types ??
        (["credit", "debit", "upi_intent"] as any),
      authentication_type: "three_ds",
      capture_method: this.options.capture_method ?? "automatic",
      metadata: { session_id },
      profile_id: this.options?.profile_id,
      billing: {
        email: email,
        address: {
          city: billing_address?.city,
          country: billing_address?.country_code.toUpperCase(),
          line1: billing_address?.address_1,
          line2: billing_address?.address_2,
          zip: billing_address?.postal_code,
          state: billing_address?.province,
        } as any,
        ...(billing_address?.phone && {
          phone: {
            country_code: parsedPhone?.country.toUpperCase(),
            number: parsedPhone?.number,
          },
        }),
      },
      ...(customer && { customer: { id: customer.id } }),
    } as any;

    let created = false;
    if (customer?.metadata?.hyperswitch_customer_id) {
      this.logger.info(
        `[Hyperswitch]: Existing customer with hyperswitch - ${customer.metadata.hyperswitch_customer_id}`
      );
      intentBody.customer = {
        id: customer.metadata.hyperswitch_customer_id as string,
      };
    } else {
      try {
        this.logger.info(
          `[Hyperswitch]: No Customer found with Hyperswitch, creating a customer - ${email}`
        );
        const { result } = await updateCustomer(this.container).run({
          input: {
            customer_id: customer.id,
            apiKey: this.options.apiKey,
            host: this.host,
          },
        });
        if (result.success) {
          created = true;
          intentBody.customer = { id: result.customerId };
        } else {
          this.logger.error(
            `[Hyperswitch]: Unable to update medusa customer object - ${result.error} - Reason - ${result.message}`
          );
          return {
            error: "Unable to initiate payment, error at customer create",
          };
        }
      } catch (error) {
        this.logger.error("Cannot create customer", error);
        return {
          error: "Unable to initiate payment, error at customer create",
        };
      }
    }

    let sessionData: PaymentProviderSessionResponse["data"];
    try {
      sessionData = (await client.paymentIntents.create(
        intentBody
      )) as unknown as PaymentProviderSessionResponse["data"];
      this.logger.info(`[Hyperswitch]: Payment intent created`);
    } catch (error) {
      this.logger.error("Cannot create Payment intent", error);
      return {
        error: "Unable to initiate payment, error at Payment create",
      };
    }

    return { data: {...sessionData, id: sessionData.payment_id} };
  }
  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    return await this.cancelPayment(paymentSessionData);
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    const client = await this.getClient();
    if (!client) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to load Hyperswitch module"
      );
    }

    const paymentId = paymentSessionData.payment_id as string;
    const paymentIntent = await client.paymentIntents.retrieve(paymentId);

    switch (paymentIntent.status) {
      case "requires_payment_method":
      case "requires_confirmation":
      case "processing":
        return PaymentSessionStatus.PENDING;
      case "requires_action":
        return PaymentSessionStatus.REQUIRES_MORE;
      case "requires_capture":
        return PaymentSessionStatus.AUTHORIZED;
      case "succeeded":
        return PaymentSessionStatus.CAPTURED;
      case "canceled":
        return PaymentSessionStatus.CANCELED;
      default:
        return PaymentSessionStatus.PENDING;
    }
  }

  async refundPayment(
    paymentData: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    const client = await this.getClient();
    if (!client) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to load Hyperswitch module"
      );
    }

    try {
      // Make sure `paymentId` is available in payment session Data.
      const paymentId = paymentData.payment_id as string;
      if (!paymentId) {
        this.logger.error(
          `[Hyperswitch]: Refund failed! - ${JSON.stringify(paymentData)}`
        );
        return;
      }
      const sessionId = (paymentData as any).metadata.session_id;
      const refunedResult = await client.refunds.create({
        payment_id: paymentId,
        amount: refundAmount,
      } as any);

      this.logger.info(
        `[Hyperswitch]: Payment refund completed - ${JSON.stringify(
          refunedResult
        )}`
      );

      return paymentData;
    } catch (error) {
      // Payment session data shouldn't removed, should work even for retries.
      console.log(error)
      this.logger.info(`[Hyperswitch]: Refund Payment Failed`);
      return { error: "Unable to refund payment", ...paymentData };
    }
  }
  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    const client = await this.getClient();
    if (!client) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to load Hyperswitch module"
      );
    }
    try {
      const id = paymentSessionData.payment_id as string;
      const paymentInfo = await client.paymentIntents.retrieve(id);
      this.logger.info(`[Hyperswitch]: Retrive Payment successful`);
      return {...paymentInfo, id: (paymentInfo as any).payment_id} as unknown as PaymentProviderSessionResponse["data"];
    } catch (error) {
      this.logger.error(`[Hyperswitch]: Unable to fetch payment info`, error);
      return { error: "Unable to retrieve payment" };
    }
  }
  async updatePayment(
    context: UpdatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const client = await this.getClient();
    if (!client) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to load Hyperswitch module"
      );
    }
    try {
      const { amount, data, currency_code, context: paymentContext } = context;
      const paymentId = data.payment_id as string;

      const customerId =
        paymentContext?.customer?.metadata?.hyperswitch_customer_id;
      if (customerId !== data.customer_id) {
        // Mismatch, create a new payment instead of updating
        const result = await this.initiatePayment(context);
        if (isPaymentProviderError(result)) {
          this.logger.error(
            `[Hyperswitch]: Unable to update payment - ${result}`
          );
          return { error: "Unable to update payment" };
        }
        return result;
      } else {
        const updateResult = await client.paymentIntents.update(paymentId, {
          amount: getSmallestUnit(amount, currency_code),
        });

        this.logger.info("[Hyperswitch]: Payment update successful");

        return { data: updateResult as unknown as any };
      }
    } catch (error) {
      this.logger.error(`[Hyperswitch] Unable to fetch payment info`, error);
      return { error: "Unable to update payment" };
    }
  }

  constructWebhookEvent(data: any, sign: string) {
    const encoded = typeof data === "string" ? data : JSON.stringify(data);
    const hashedBody = createHmac("sha512", this.options.webhook_key ?? "")
      .update(encoded, "utf-8")
      .digest("hex");
    this.logger.info(
      `[Hyperswitch] - Decoded hash ${hashedBody} - Hash From server - ${sign}`
    );
    if (hashedBody === sign) {
      return typeof data === "string" ? JSON.parse(data) : data;
    }
    throw new Error("Unable to verify the webhook payload");
  }

  async getWebhookActionAndData(
    data: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const signature = data.headers["x-webhook-signature-512"] as string;

    const body = data.data as any;
    try {
      this.logger.info(`[Hyperswitch]: Webhook event construction`);
      const event = this.constructWebhookEvent(body, signature);
      const paymentIntent = event.content.object;

      const currency = paymentIntent.currency.toLowerCase() as string;

      const sessionId = paymentIntent.metadata.session_id;
      const amount = getAmountFromSmallestUnit(
        paymentIntent.amount_capturable,
        currency.toLowerCase()
      );

      this.logger.info(
        `[Hyperswitch]: Webhook event recied with type - ${event.event_type} with payment Id - ${paymentIntent.payment_id}`
      );

      switch (event.event_type as WebhookEvent) {
        case "payment_authorized": {
          return {
            action: PaymentActions.AUTHORIZED,
            data: {
              amount: amount,
              session_id: sessionId,
            },
          };
        }
        case "payment_succeeded": {
          return {
            action: PaymentActions.SUCCESSFUL,
            data: {
              amount: amount,
              session_id: sessionId,
            },
          };
        }
        case "payment_failed": {
          return {
            action: PaymentActions.FAILED,
            data: {
              amount: amount,
              session_id: sessionId,
            },
          };
        }
        case "refund_failed": {
          // handle refund failed
        }
        case "refund_succeeded": {
          // handle refund success
          const { result } = await updateRefund(this.container).run({
            input: {
              ...paymentIntent,
            },
          });

          if (!result.success) {
            this.logger.info(
              `[Webhook]: Refund status update failed - ${result.error}`
            );
          }
        }
        default:
          return { action: PaymentActions.NOT_SUPPORTED };
      }
    } catch (error) {
      this.logger.error(
        `[Hyperswitch]: Webhook event failed - ${JSON.stringify(data)}`
      );
      return { action: PaymentActions.NOT_SUPPORTED };
    }
  }
  // TODO implement methods
}

export default MyPaymentProviderService;

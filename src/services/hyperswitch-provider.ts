import {
  AbstractPaymentProcessor,
  PaymentProcessorContext,
  PaymentProcessorError,
  PaymentProcessorSessionResponse,
  PaymentSessionStatus,
  Logger,
  isPaymentProcessorError,
} from "@medusajs/medusa";
import { createHmac } from "node:crypto";
import { EntityManager } from "typeorm";
import { callbackify } from "node:util";

// @ts-ignore
import Hyperswitch from "@juspay-tech/hyperswitch-node";
import Stripe from "@juspay-tech/hyper-node";

interface Options {
  api_key: string;
  sandbox?: boolean;
  allowed_payment_method_types: string[];
  webhook_response_hash: string;
}

class HyperswitchProviderService extends AbstractPaymentProcessor {
  static identifier = "hyperswitch";

  protected hyperswitch: Stripe = null;
  protected readonly logger: Logger = null;

  protected readonly options: Options | undefined = undefined;
  protected readonly container: any | undefined = undefined;
  protected webhookKey: string | undefined = undefined;

  protected constructor(
    container: Record<string, unknown>,
    options?: Record<string, unknown>
  ) {
    super(container, options);
    this.options = options as unknown as Options;
    this.container = container;
    this.logger = container.logger as unknown as Logger;

    this.logger.info("[Hyperswitch] Payment provider initiated");
  }

  async loadSettings(
    container: Record<string, unknown>,
    options?: Record<string, unknown>
  ) {
    if (this.hyperswitch) {
      return this.hyperswitch;
    }
    const manager = container.manager as EntityManager;
    const ppModel = container.paymentProviderModel as any;
    const provider = await manager.findOne<any>(ppModel, {
      where: { id: "hyperswitch" },
      select: ["settings"],
    });

    const host = !options?.sandbox
      ? "api.hyperswitch.io"
      : "sandbox.hyperswitch.io";

    if (!provider) {
      this.logger.info(
        `[Hyperswitch] - Trying to load Keys from Medusa Config Options`
      );
      const key = options?.api_key;
      if (!key) {
        throw new Error("API key not found!");
      }
      this.webhookKey = options.webhook_response_hash as string;
      this.hyperswitch = new Hyperswitch(key, {
        host: host,
      });
      return this.hyperswitch;
    } else {
      let settingsJSON = JSON.parse(
        provider?.settings ?? "{}"
      ) as unknown as Options;

      if (!settingsJSON) {
        this.logger.warn(
          `[Hyperswitch] - Plugin Registartion is not fully completed, Use Admin or Config to provide the API Keys to use with hyperswitch client`
        );
        return;
      }

      if (typeof settingsJSON === "string") {
        settingsJSON = JSON.parse(settingsJSON);
      }

      try {
        this.logger.info(
          `[Hyperswitch] - Trying to load Keys from DB Options - ${JSON.stringify(
            settingsJSON
          )}`
        );
        const key = settingsJSON.api_key;
        if (!key) {
          throw new Error("API key not found!");
        }
        this.webhookKey = settingsJSON.webhook_response_hash as string;
        this.hyperswitch = new Hyperswitch(key, {
          host: host,
        });
        this.logger.info(`[Hyperswitch] - Loaded form database`);
        return this.hyperswitch;
      } catch (error) {
        this.logger.info(
          `[Hyperswitch] - Unable to set hyperswitch Client. ${error}`
        );
      }
    }
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    const client = await this.loadSettings(this.container, this.options as any);
    if (!client) {
      return { error: "unknow error happened" };
    }
    const id = paymentSessionData.payment_id as string;
    const paymentInfo = await client.paymentIntents.retrieve(id);
    // We don't need to mark the payment `capture` if the status is already `succeeded`
    if (paymentInfo.status === "succeeded") {
      this.logger.info(
        `[Hyperswitch] - Payment status is ${paymentInfo.status} - No need to capture`
      );
      return paymentInfo as unknown as PaymentProcessorSessionResponse["session_data"];
    }
    try {
      const intent = await client.paymentIntents.capture(id);
      this.logger.info(`[Hyperswitch]: Payment Captured with id - ${id}`);
      return intent as unknown as PaymentProcessorSessionResponse["session_data"];
    } catch (error) {
      this.logger.error(error);
      return { error: "unknow error happened" };
    }
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<
    | PaymentProcessorError
    | {
        status: PaymentSessionStatus;
        data: PaymentProcessorSessionResponse["session_data"];
      }
  > {
    const client = await this.loadSettings(this.container, this.options as any);
    if (!client) {
      return { error: "unknow error happened" };
    }
    const status = await this.getPaymentStatus(paymentSessionData);
    this.logger.info(`[Hyperswitch]: Payment Status fetch - ${status}`);
    return { data: paymentSessionData, status };
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    const client = await this.loadSettings(this.container, this.options as any);
    if (!client) {
      return { error: "unknow error happened" };
    }
    try {
      const paymentId = paymentSessionData.payment_id as string;
      const deleted = await client.paymentIntents.cancel(paymentId);
      return deleted as unknown as PaymentProcessorSessionResponse["session_data"];
    } catch (error) {
      this.logger.info(`[Hyperswitch]: Payment cancel failed - ${error}`);
      return { error: "Unable to cancel the payment" };
    }
  }

  async initiatePayment(
    context: PaymentProcessorContext
  ): Promise<PaymentProcessorError | PaymentProcessorSessionResponse> {
    const client = await this.loadSettings(this.container, this.options as any);
    if (!client) {
      return { error: "unknow error happened" };
    }
    try {
      const {
        email,
        currency_code,
        amount,
        resource_id,
        customer,
        context: _context,
      } = context;
      const { payment_description } = _context;
      const intentRequest: Stripe.PaymentIntentCreateParams = {
        description: (payment_description as string) ?? "",
        amount: amount,
        currency: currency_code.toUpperCase(),
        metadata: { resource_id },
        authentication_type: "three_ds",
        capture_method: "automatic",
        allowed_payment_method_types: ["credit", "cashapp"],
      } as any;

      let created = false;
      if (customer?.metadata?.hyperswitch_customer_id) {
        this.logger.info(
          `[Hyperswitch]: Existing customer with hyperswitch - ${customer.metadata.hyperswitch_customer_id}`
        );
        intentRequest.customer = {
          id: customer.metadata.hyperswitch_customer_id as string,
        };
      } else {
        try {
          this.logger.info(
            `[Hyperswitch]: No Customer found with Hyperswitch, creating a customer - ${email}`
          );
          const customer = await client.customers.create({
            email: email,
          });
          intentRequest.customer = { id: (customer as any).customer_id };
          created = true;
        } catch (error) {
          this.logger.error("Cannot create customer", error);
          return {
            error: "Unable to initiate payment, error at customer create",
          };
        }
      }

      let sessionData: PaymentProcessorSessionResponse["session_data"];
      try {
        sessionData = (await client.paymentIntents.create(
          intentRequest
        )) as unknown as PaymentProcessorSessionResponse["session_data"];
      } catch (error) {
        this.logger.error("Cannot create Payment intent", error);
        return {
          error: "Unable to initiate payment, error at Payment create",
        };
      }

      return {
        session_data: sessionData,
        update_requests: created
          ? {
              customer_metadata: {
                hyperswitch_customer_id: intentRequest.customer?.id,
              },
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error("[Hyperswitch]: Payment Initiate failed", error);
      return { error: "Payment initiation failed" };
    }
  }

  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    const client = await this.loadSettings(this.container, this.options as any);
    if (!client) {
      return { error: "unknow error happened" };
    }
    return await this.cancelPayment(paymentSessionData);
  }

  // Payment Status transofmration according to the medusaJS
  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    const client = await this.loadSettings(this.container, this.options as any);
    if (!client) {
      return PaymentSessionStatus.ERROR;
    }
    try {
      const id = paymentSessionData.payment_id as string;
      const paymentInfo = await client.paymentIntents.retrieve(id);
      switch (paymentInfo.status) {
        case "requires_payment_method":
        case "requires_confirmation":
        case "processing":
          return PaymentSessionStatus.PENDING;
        case "requires_action":
          return PaymentSessionStatus.REQUIRES_MORE;
        case "requires_capture":
        case "succeeded":
          return PaymentSessionStatus.AUTHORIZED;
        case "canceled":
          return PaymentSessionStatus.CANCELED;
        default:
          return PaymentSessionStatus.PENDING;
      }
    } catch (error) {
      this.logger.error("Cannot get payment status", error);
      return PaymentSessionStatus.ERROR;
    }
  }

  // Refund
  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    const client = await this.loadSettings(this.container, this.options as any);
    if (!client) {
      return { error: "unknow error happened" };
    }
    try {
      // Make sure `paymentId` is available in payment session Data.
      const paymentId = paymentSessionData.payment_id as string;
      if (!paymentId) {
        this.logger.error(
          `[Hyperswitch]: Refund failed! - ${JSON.stringify(
            paymentSessionData
          )}`
        );
        return;
      }
      const refunedResult = await client.refunds.create({
        amount: refundAmount,
        payment_id: paymentId,
      } as any);

      this.logger.info(
        `[Hyperswitch]: Payment refund completed - ${JSON.stringify(
          refunedResult
        )}`
      );

      return paymentSessionData;
    } catch (error) {
      // Payment session data shouldn't removed, should work even for retries.
      this.logger.info(`[Hyperswitch]: Refund Payment Failed - ${error}`);
      return { error: "Unable to refund payment", ...paymentSessionData };
    }
  }

  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    const client = await this.loadSettings(this.container, this.options as any);
    if (!client) {
      return { error: "unknow error happened" };
    }
    try {
      const id = paymentSessionData.payment_id as string;
      const paymentInfo = await client.paymentIntents.retrieve(id);
      this.logger.info(`[Hyperswitch]: Retrive Payment successful`);
      return paymentInfo as unknown as PaymentProcessorSessionResponse["session_data"];
    } catch (error) {
      this.logger.error(`[Hyperswitch]: Unable to fetch payment info`, error);
      return { error: "Unable to retrieve payment" };
    }
  }

  /**
   * @description Function to Update the payment details
   * @param {PaymentProcessorContext} context
   * @returns {PaymentProcessorError | PaymentProcessorSessionResponse | void}
   */
  async updatePayment(
    context: PaymentProcessorContext
  ): Promise<PaymentProcessorError | PaymentProcessorSessionResponse | void> {
    const client = await this.loadSettings(this.container, this.options as any);
    if (!client) {
      return { error: "unknow error happened" };
    }
    try {
      const { amount, paymentSessionData, customer } = context;
      const paymentId = paymentSessionData.payment_id as string;

      const customerId = customer?.metadata?.hyperswitch_customer_id;
      if (customerId !== paymentSessionData.customer_id) {
        // Mismatch, create a new payment instead of updating
        const result = await this.initiatePayment(context);
        if (isPaymentProcessorError(result)) {
          this.logger.error("[Hyperswitch]: Unable to update payment", result);
          return { error: "Unable to update payment" };
        }
        return result;
      } else {
        const updateResult = await client.paymentIntents.update(paymentId, {
          amount: amount,
        });

        this.logger.info("[Hyperswitch]: Payment update successful");

        return { session_data: updateResult as unknown as any };
      }
    } catch (error) {
      this.logger.error(`[Hyperswitch] Unable to fetch payment info`, error);
      return { error: "Unable to update payment" };
    }
  }

  updatePaymentData(
    sessionId: string,
    data: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    throw new Error("Method not implemented.");
  }

  /**
   * @description Function to verify the webhook data recieved from payment gateway.
   * @param {Record<string, any>} data Data recieved from webhook
   * @param {String} sign Signature recieved from webhook server to verify
   * @returns {Record<string, any> | Error}
   */
  constructWebhookEvent(data: any, sign: string) {
    const encoded = typeof data === "string" ? data : JSON.stringify(data);
    const hashedBody = createHmac(
      "sha512",
      this.options.webhook_response_hash ?? ""
    )
      .update(encoded, "utf-8")
      .digest("hex");
    this.logger.info(
      `[Hyperswitch] - Decoded hash ${hashedBody} - Hash From server - ${sign}`
    );
    if (hashedBody === sign) {
      return typeof data === "string" ? JSON.parse(data) : data;
    }
    return new Error("Unable to verify the webhook payload");
  }
}

export default HyperswitchProviderService;

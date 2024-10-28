import {
  AbstractPaymentProcessor,
  PaymentProcessorContext,
  PaymentProcessorError,
  PaymentProcessorSessionResponse,
  PaymentSessionStatus,
  Logger,
  isPaymentProcessorError,
} from "@medusajs/medusa";
// @ts-ignore
import Hyperswitch from "@juspay-tech/hyperswitch-node";
import Stripe from "@juspay-tech/hyper-node";

interface Options {
  api_key: string;
  sandbox?: boolean;
  allowed_payment_method_types: string[];
}

class HyperswitchProviderService extends AbstractPaymentProcessor {
  static identifier = "hyperswitch";

  protected hyperswitch: Stripe = null;
  protected readonly logger: Logger = null;

  protected readonly options: Options | undefined = undefined;

  protected constructor(
    container: Record<string, unknown>,
    options?: Record<string, unknown>
  ) {
    super(container, options);
    this.options = options as unknown as Options;
    const key = options?.api_key;
    if (!key) {
      throw new Error("API key not found!");
    }
    this.hyperswitch = new Hyperswitch(key, {
      host: options?.sandbox ? "sandbox.hyperswitch.io" : "api.hyperswitch.io",
    });
    this.logger = container.logger as unknown as Logger;
    this.logger.info("[Hyperswitch] Payment provider initiated");
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    const id = paymentSessionData.payment_id as string;
    try {
      const intent = await this.hyperswitch.paymentIntents.capture(id);
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
    const status = await this.getPaymentStatus(paymentSessionData);
    this.logger.info(`[Hyperswitch]: Payment Status fetch - ${status}`);
    return { data: paymentSessionData, status };
  }
  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    try {
      const paymentId = paymentSessionData.payment_id as string;
      const deleted = await this.hyperswitch.paymentIntents.cancel(paymentId);
      return deleted as unknown as PaymentProcessorSessionResponse["session_data"];
    } catch (error) {
      this.logger.info(`[Hyperswitch]: Payment cancel failed - ${error}`);
      return { error: "Unable to cancel the payment" };
    }
  }
  async initiatePayment(
    context: PaymentProcessorContext
  ): Promise<PaymentProcessorError | PaymentProcessorSessionResponse> {
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
        customer_acceptance: { acceptance_type: "online" },
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
          const customer = await this.hyperswitch.customers.create({
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
        sessionData = (await this.hyperswitch.paymentIntents.create(
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
                hyperswitch_customer_id: intentRequest.customer.id,
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
    return await this.cancelPayment(paymentSessionData);
  }
  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    try {
      const id = paymentSessionData.payment_id as string;
      const paymentInfo = await this.hyperswitch.paymentIntents.retrieve(id);
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
  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    try {
      const paymentId = paymentSessionData.payment_id as string;
      const refunedResult = await this.hyperswitch.refunds.create({
        amount: refundAmount,
        payment_intent: paymentId,
      });

      this.logger.info(
        `[Hyperswitch]: Payment refund completed - ${JSON.stringify(
          refunedResult
        )}`
      );

      return paymentSessionData;
    } catch (error) {
      this.logger.info(`[Hyperswitch]: Refund Payment Failed - ${error}`);
      return { error: "Unable to refund payment" };
    }
  }
  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    try {
      const id = paymentSessionData.payment_id as string;
      const paymentInfo = await this.hyperswitch.paymentIntents.retrieve(id);
      this.logger.info(`[Hyperswitch]: Retrive Payment successful`);
      return paymentInfo as unknown as PaymentProcessorSessionResponse["session_data"];
    } catch (error) {
      this.logger.error(`[Hyperswitch]: Unable to fetch payment info`, error);
      return { error: "Unable to retrieve payment" };
    }
  }
  async updatePayment(
    context: PaymentProcessorContext
  ): Promise<PaymentProcessorError | PaymentProcessorSessionResponse | void> {
    try {
      const { amount, resource_id, paymentSessionData, customer } = context;
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
        const updateResult = await this.hyperswitch.paymentIntents.update(
          paymentId,
          {
            amount: amount,
            payment_method: null,
            payment_method_data: null,
          }
        );

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
}

export default HyperswitchProviderService;

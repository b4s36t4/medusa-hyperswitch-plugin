import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";

export const updateRefundStatus = createStep<
  {
    refund_id: string;
    payment_id: string;
    metadata: any;
    amount: number;
    currency: string;
    status: string;
  },
  { success: boolean; error?: string },
  any
>("updateRefundStatus", async (input, context) => {
  //   const { customer_id, hyperswitch_customer_id } = input;
  //   if (!customer_id) {
  //     return;
  //   }
  console.log(context.container.registrations, "cache");
  //   const customerService = context.container.resolve("customer");
  //   const logger = context.container.resolve("logger");
  //   if (!customerService) {
  //     return;
  //   }

  //   const customer = await customerService.retrieveCustomer(customer_id);
  //   if (!customer) {
  //     return new StepResponse({
  //       success: false,
  //       error: `Unable to find customer with id ${customer_id}`,
  //     });
  //   }

  //   if (customer.metadata.hyperswitch_customer_id) {
  //     return new StepResponse({ success: true });
  //   }

  //   try {
  //     const updatedCustomer = await customerService.updateCustomers(customer_id, {
  //       metadata: {
  //         hyperswitch_customer_id: hyperswitch_customer_id,
  //       },
  //     });
  //     if (!updatedCustomer) {
  //       return new StepResponse({
  //         success: false,
  //         error: "Unable to update customer id",
  //       });
  //     }
  //   } catch (error) {
  //     logger.error("Unable to update customer metadata");
  //     return new StepResponse({
  //       success: false,
  //       error: "Unable to update customer id",
  //     });
  //   }

  return new StepResponse({ success: true });
});

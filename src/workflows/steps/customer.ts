// @ts-ignore
import HyperSwitch from "@juspay-tech/hyperswitch-node";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";

export const updateCustomerStep = createStep<
  { customer_id: string; apiKey: string; host: string },
  { success: boolean; error?: string; message?: any; customerId?: string },
  any
>("updateCustomerStep", async (input, context) => {
  const { customer_id, host, apiKey } = input;
  if (!customer_id) {
    return;
  }

  const client = new HyperSwitch(apiKey, {
    host: host,
  });

  const customerService = context.container.resolve("customer");
  if (!customerService) {
    return;
  }

  const customer = await customerService.retrieveCustomer(customer_id);
  if (!customer) {
    return new StepResponse({
      success: false,
      error: `Unable to find customer with id ${customer_id}`,
    });
  }

  if (customer.metadata?.hyperswitch_customer_id) {
    return new StepResponse({
      success: true,
      customerId: customer.metadata?.hyperswitch_customer_id,
    });
  }

  const hyperCustomer = await client.customers.create({
    email: customer.email,
  });

  const createdUserId = (hyperCustomer as any).customer_id;

  try {
    const updatedCustomer = await customerService.updateCustomers(customer_id, {
      metadata: {
        hyperswitch_customer_id: createdUserId,
      },
    });
    if (!updatedCustomer) {
      return new StepResponse({
        success: false,
        error: "Unable to update customer id",
      });
    }
  } catch (error) {
    return new StepResponse({
      success: false,
      error: "Unable to update customer id",
      message: error.message,
    });
  }

  return new StepResponse({ success: true, customerId: createdUserId });
});

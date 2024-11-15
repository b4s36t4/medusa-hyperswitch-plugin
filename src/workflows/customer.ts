import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { updateCustomerStep } from "./steps/customer";
import Stripe from "@juspay-tech/hyper-node";

export const updateCustomer = createWorkflow<
  {
    customer_id: string;
    apiKey: string;
    host: string;
  },
  { success: boolean; error?: string; message?: any; customerId?: string },
  any
>("update-customer", (input) => {
  const { customer_id, apiKey, host } = input;

  const { success, error, message, customerId } = updateCustomerStep({
    customer_id,
    apiKey,
    host,
  });

  return new WorkflowResponse({ success, error, message, customerId });
});

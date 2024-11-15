import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { updateRefundStatus } from "./steps/refund";

export const updateRefund = createWorkflow<
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
>("update-refund", (input) => {
  //   const { customer_id, hyperswitch_customer_id } = input;

  const { success, error } = updateRefundStatus({
    ...input,
  });

  return new WorkflowResponse({ success, error });
});

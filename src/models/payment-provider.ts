import { Column, Entity } from "typeorm";
import {
  // alias the core entity to not cause a naming conflict
  PaymentProvider as MedusaPaymentProvider,
} from "@medusajs/medusa";

export class HyperswitchSettings {
  api_key: string;
  webhook_response_hash: string;
}

@Entity()
export class PaymentProvider extends MedusaPaymentProvider {
  @Column({ type: "jsonb", nullable: true })
  settings: HyperswitchSettings;
}

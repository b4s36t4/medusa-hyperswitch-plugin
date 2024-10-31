import { MigrationInterface, QueryRunner } from "typeorm";

export class PaymentProviderUpdate1730385257898 implements MigrationInterface {
  name?: string = "PaymentProviderUpdate1730385257898";
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_provider" ADD COLUMN settings TEXT NULL;`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_provider" DROP COLUMN settings`
    );
  }
}

import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Heading } from "@medusajs/ui";

const ProductWidget = () => {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Hyperswitch Widget</Heading>
      </div>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "api_key.list.after",
});

export default ProductWidget;

## Installation

You can install this plugin from npm using the following command.

```sh
npm install git@github.com:b4s36t4/medusa-hyperswitch-plugin.git#feat/v2
```

> This requires `typescript` as a peer depednecy, make sure your project have `typescript` installed.

Or

```sh
npm add medusa-hyperswitch-plugin
```

## Setup

Setting up this plugin with medusa project is as simple as writing JSON.

All you need to do is extend `@medusa/payment` module to load the module from this package.

```javascript
// filename: medusa-config.ts
import { loadEnv, defineConfig } from "@medusajs/framework/utils";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

// exisitng/default config
module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  modules: [
    // Our new config.
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-plugin-hyperswitch",
            // Make sure to give unique name, this is required for further actions.
            id: "hyperswitch",
            options: {
              // provider options...
              apiKey:
                "hyperswitch_api_key",
              sandbox: true, // Weather to use sandbox apis or production apis.
              webhook_key:
                "hyperswitch_webhook_key",
              capture_method: "manual", // "manual" | "automatic" - defaults to `automatic`
              profile_id: "hyperswitch_profile_id"
            },
          },
        ],
      },
    },
  ],
});

```

### Setting up webhook.

When a new payment provider added, medusa will automatically create a webhook route for the specific provider. 

> Webhook route is dependent on provider and config options.

If the added module has `id` property then the provider name will be `pp_hyerswitch_hyperswitch` else it would be `pp_hyperswitch`.

Ex: The following is an example webhook route for the given config above.

```
https://<medusa-base-url:<?port>>/hooks/payment/hyperswitch_hyperswitch

//https://ce2c-2409-40f0-fd-36ce-555b-eae5-bf5e-c6e0.ngrok-free.app/hooks/payment/hyperswitch_hyperswitch
```

> We don't need to add `pp` before, we just need to add the provider name. 

### Setting up Storefront.

Medusa does have ax example storefront built with Next.js, we can use that storefront to extend the hyperswitch payment method. 

You can also find the example storefront available [Here](url)

### Storefront Payment session creation.

The `medusa-hyperswitch-plugin` expects some extra data when creating a payment intent. This needs to be passed from storefront.

Make sure to pass the information related to customer, billing_address and email to the `sdk.store.payment.initiatePaymentSession` function which will then passed to the plugin.

[Click here](https://github.com/b4s36t4/medusa-hs-store/blob/13d791a51dc40f4e03a0a96d95535ea30e6b5cc9/src/modules/checkout/components/payment/index.tsx#L92) to see example implementation of the above function on how to pass the extra information.

#### Payment flow with Hyperswitch

![image](https://github.com/user-attachments/assets/621ab994-609c-4431-86a7-e4365bcaab90)




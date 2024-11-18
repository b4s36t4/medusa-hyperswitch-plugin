## Installation

You can install this plugin from npm using the following command.

```sh
npm install git@github.com:b4s36t4/medusa-hyperswitch-plugin.git#feat/v2
```

> This requires `typescript` as a peer depednecy, make sure you project have `typescript` installed.

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

const dotenv = require("dotenv");

let ENV_FILE_NAME = "";
switch (process.env.NODE_ENV) {
    case "production":
        ENV_FILE_NAME = ".env.production";
        break;
    case "staging":
        ENV_FILE_NAME = ".env.staging";
        break;
    case "test":
        ENV_FILE_NAME = ".env.test";
        break;
    case "development":
    default:
        ENV_FILE_NAME = ".env";
        break;
}

try {
    dotenv.config({ path: process.cwd() + "/" + ENV_FILE_NAME });
} catch (e) { }


const plugins = [
    {
        resolve: "@medusajs/admin",
        /** @type {import('@medusajs/admin').PluginOptions} */
        options: {
            autoRebuild: true,
            develop: {
                open: process.env.OPEN_BROWSER !== "false",
            },
        },
    },
];

const modules = {
    /*eventBus: {
      resolve: "@medusajs/event-bus-redis",
      options: {
        redisUrl: REDIS_URL
      }
    },
    cacheService: {
      resolve: "@medusajs/cache-redis",
      options: {
        redisUrl: REDIS_URL
      }
    },*/
};


/** @type {import('@medusajs/medusa').ConfigModule} */
module.exports = {
    projectConfig: {},
    plugins,
    modules,
};

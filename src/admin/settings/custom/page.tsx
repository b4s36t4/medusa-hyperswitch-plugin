import type { SettingConfig } from "@medusajs/admin";
import { useAdminCustomPost } from "medusa-react";

import { Button, Input } from "@medusajs/ui";
import { useCallback, useState } from "react";
import { RouteProps } from "@medusajs/admin";

// import { CustomIcon } from "../../icons/custom";

const CustomSettingPage = ({ notify }: RouteProps) => {
  const [apiKey, setApiKey] = useState("");
  const [webhookKey, setWebhookKey] = useState("");

  const { isLoading, mutateAsync } = useAdminCustomPost(
    "/hyperswitch/settings",
    ["hyperswitch", "settings"]
  );

  const onUpdateSettings = useCallback(async () => {
    if (!apiKey || !webhookKey) {
      notify.warn("Invalid Values", "Please enter values");
      return;
    }
    await mutateAsync({
      api_key: apiKey,
      webhook_response_hash: webhookKey,
    });
    notify.success(
      "Success",
      "Settings updated, please reload your medusa server"
    );
    setApiKey("");
    setWebhookKey("");
  }, [apiKey, webhookKey]);

  return (
    <div className="flex flex-col w-5/12">
      <p className="text-2xl">Manage Your Hyperswitch Settings here</p>
      <div className="w-full">
        <div className="mt-8 mb-4 flex flex-col items-start w-full">
          <div className="w-[500px]">
            <Input
              placeholder="Enter API Key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
              }}
              className="w-full"
              width={"100%"}
            />
          </div>
          <span className="flex items-center text-sm">
            <a
              className="mr-1 text-gray-800 underline font-bold"
              href="https://docs.hyperswitch.io/hyperswitch-cloud/account-setup#user-content-create-an-api-key-1"
              target="_blank"
            >
              Click Here
            </a>
            to know how to get API Key
          </span>
        </div>
        <div className="my-4 flex flex-col items-start w-full">
          <div className="w-[500px]">
            <Input
              placeholder="Enter Webhook Secret"
              type="text"
              value={webhookKey}
              onChange={(e) => {
                setWebhookKey(e.target.value);
              }}
              className="w-full"
              width={"100%"}
            />
          </div>
          <span className="flex items-center text-sm">
            <a
              className="mr-1 text-gray-800 underline font-bold"
              href="https://docs.hyperswitch.io/hyperswitch-cloud/webhooks"
              target="_blank"
            >
              Click Here
            </a>
            to know how more on webhooks & integration
          </span>
        </div>
        <Button size="large" onClick={onUpdateSettings} isLoading={isLoading}>
          Update
        </Button>
      </div>
    </div>
  );
};

export const config: SettingConfig = {
  card: {
    label: "Hyperswitch",
    description: "Manage your Hyperswitch settings",
    // optional
    // icon: CustomIcon,
  },
};

export default CustomSettingPage;

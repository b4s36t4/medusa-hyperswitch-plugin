#!/usr/bin/env node

import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs/promises";

const TEMPLATE_COMPONENT = `
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Settings } from "medusa-plugin-hyperswitch/admin";

// Settings Component
export default Settings;

export const config = defineRouteConfig({
  label: "Hyperswitch Settings",
});
`;

yargs(hideBin(process.argv))
  .command(
    "generate",
    "Generates Admin component",
    () => {},
    async (args) => {
      console.log("[Runner] Not yet read!");
      return;
      try {
        console.info("[Runner] Creating Folder");
        const folderPath = path.join(
          process.cwd(),
          "src",
          "admin",
          "routes",
          "settings",
          "hyperswitch"
        );
        await fs.mkdir(folderPath, {
          recursive: true,
        });
        console.info("[Runner] Folder created");
        const filePath = path.join(folderPath, "page.tsx");
        await fs.writeFile(filePath, TEMPLATE_COMPONENT);

        console.info("[Runner] Admin route created successfully!");
      } catch (error) {
        console.error(error);
      }

      console.log("[Runner] Done");
    }
  )
  .strictCommands()
  .parse();

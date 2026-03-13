#!/usr/bin/env node

import dotenv from "dotenv";
import chalk from "chalk";
import figlet from "figlet";
import { Command } from "commander";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { login, logout, whoami } from "./commands/auth/login.js";
import { createWakeUpCommand } from "./commands/ai/wakeUp.js";
import { history } from "./commands/history/history.js";

// Capture the directory where `orbit` was invoked, before any async work.
const INVOCATION_DIR = process.cwd();

// Resolve .env relative to this script file so it works from any directory.
const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = dirname(currentFilePath);
dotenv.config({ path: resolve(currentDirPath, "../../../.env") });

async function main() {
    console.log(
        chalk.cyan(
            figlet.textSync("Orbital CLI", {
                font: "Standard",
                horizontalLayout: "default"
            })
        
        )
    )

    console.log(chalk.gray("A cli based AI Tool \n"))

    const program = new Command("orbit");

    program.version("0.0.1")
    .description("Orbital CLI - A Cli Based AI Tool")
    .addCommand(login)
    .addCommand(logout)
    .addCommand(whoami)
    .addCommand(createWakeUpCommand(INVOCATION_DIR))
    .addCommand(history)

    if (process.argv.slice(2).length === 0) {
        program.outputHelp();
        process.exit(0);
    }

    program.parse();


}
main().catch((err) => {
    console.log(chalk.red("Error running Orbital CLI"), err)
    process.exit(1)
})
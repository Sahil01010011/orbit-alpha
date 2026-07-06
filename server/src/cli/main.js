#!/usr/bin/env node

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = dirname(currentFilePath);

import dotenv from "dotenv";
dotenv.config({ path: resolve(currentDirPath, "../../../.env"), quiet: true });

import chalk from "chalk";
import { Command } from "commander";
import { login, logout, whoami } from "./commands/auth/login.js";
import { createWakeUpCommand } from "./commands/ai/wakeUp.js";
import { history } from "./commands/history/history.js";

process.removeAllListeners("warning");

const INVOCATION_DIR = process.cwd();

async function main() {
    console.log(chalk.hex('#22d3ee')('  ██████╗ ') + chalk.hex('#38bdf8')('██████╗ ') + chalk.hex('#818cf8')('██████╗ ') + chalk.hex('#a78bfa')('██╗████████╗'));
    console.log(chalk.hex('#22d3ee')(' ██╔═══██╗') + chalk.hex('#38bdf8')('██╔══██╗') + chalk.hex('#818cf8')('██╔══██╗') + chalk.hex('#a78bfa')('██║╚══██╔══╝'));
    console.log(chalk.hex('#22d3ee')(' ██║   ██║') + chalk.hex('#38bdf8')('██████╔╝') + chalk.hex('#818cf8')('██████╔╝') + chalk.hex('#a78bfa')('██║   ██║  '));
    console.log(chalk.hex('#22d3ee')(' ██║   ██║') + chalk.hex('#38bdf8')('██╔══██╗') + chalk.hex('#818cf8')('██╔══██╗') + chalk.hex('#a78bfa')('██║   ██║  '));
    console.log(chalk.hex('#22d3ee')(' ╚██████╔╝') + chalk.hex('#38bdf8')('██║  ██║') + chalk.hex('#818cf8')('██████╔╝') + chalk.hex('#a78bfa')('██║   ██║  '));
    console.log(chalk.hex('#22d3ee')('  ╚═════╝ ') + chalk.hex('#38bdf8')('╚═╝  ╚═╝') + chalk.hex('#818cf8')('╚═════╝ ') + chalk.hex('#a78bfa')('╚═╝   ╚═╝  '));
    console.log(chalk.hex('#c084fc')(' orbit α · autonomous cli developer agent'));
    console.log('');

    const program = new Command("orbit");

    program.version("0.0.1")
        .description("Orbital CLI - A Cli Based AI Tool")
        .addCommand(login)
        .addCommand(logout)
        .addCommand(whoami)
        .addCommand(createWakeUpCommand(INVOCATION_DIR))
        .addCommand(history);

    if (process.argv.slice(2).length === 0) {
        program.outputHelp();
        process.exit(0);
    }

    program.parse();
}

main().catch((err) => {
    console.log(chalk.red("Error running Orbital CLI"), err);
    process.exit(1);
});



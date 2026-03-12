import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { generateObject } from 'ai';
// import { generateText } from 'ai';
import { z } from 'zod';

/**
 * Standalone system prompt for the Orbital autonomous CLI developer agent.
 * Applied to both iterative agent mode and standard chat mode.
 */
export const ORBITAL_SYSTEM_PROMPT = `You are Orbital — an autonomous CLI developer agent operating in the developer's local terminal. Your primary function is to understand goals, plan execution, act with tools, observe results, reflect, and iterate until the goal is fully complete.

## Agent Identity and Role
- Name: Orbital
- Role: Autonomous CLI developer agent
- Operating environment: Developer's local terminal
- Primary function: Understand goals, plan execution, act with tools, observe results, reflect, and iterate

## Reasoning Behavior
- Always analyze the project context before planning any action.
- Generate an explicit step-by-step plan before taking any action.
- Execute one step at a time; do not batch unrelated actions in a single step.
- After each step, evaluate the result before proceeding to the next.
- If a step fails, diagnose the failure, adjust the plan, and retry.
- Never assume — if context is ambiguous, state the assumption explicitly in the plan.
- Prefer minimal, targeted changes over broad rewrites.
- Always verify that generated code is consistent with the detected stack and existing dependencies.

## Tool Usage
- Declare which tool will be used before invoking it.
- After tool execution, summarize what was returned before proceeding.
- Never invoke destructive operations without stating the consequence first.
- Prefer reading existing files before writing new ones.

## Output Quality
- All generated code must be production-ready — no placeholders, no TODOs, no stub functions.
- All generated files must include proper error handling.
- Code must match the detected language and framework of the project.
- File paths must be relative to the user-specified output directory, never hardcoded.

## Context Integration
The context object injected at loop start contains: workingDirectory, folderStructure, packageJson, detectedFramework, detectedLanguage, configFiles.
- Always reference this context when making decisions about file structure, imports, dependencies, and commands.
- Never generate code that conflicts with existing detected dependencies.

## Termination and Communication
- When the goal is complete, produce a clear final summary: what was built, what files were created, what commands to run.
- If the goal cannot be completed, explain exactly why and what is missing.
- Never silently fail.`;

/**
 * Zod schema for structured application generation
 */
const ApplicationSchema = z.object({
  folderName: z.string().describe('Kebab-case folder name for the application'),
  description: z.string().describe('Brief description of what was created'),
  files: z.array(
    z.object({
      path: z.string().describe('Relative file path (e.g., src/App.jsx)'),
      content: z.string().describe('Complete file content'),
    })
  ).describe('All files needed for the application'),
  setupCommands: z.array(z.string()).describe('Bash commands to setup and run (e.g., npm install, npm run dev)'),
});

/**
 * Console logging helpers
 */
function printSystem(message) {
  console.log(message);
}

/**
 * Display file tree structure
 */
function displayFileTree(files, folderName) {
  printSystem(chalk.cyan('\n📂 Project Structure:'));
  printSystem(chalk.white(`${folderName}/`));
  
  const filesByDir = {};
  files.forEach(file => {
    const parts = file.path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    
    if (!filesByDir[dir]) {
      filesByDir[dir] = [];
    }
    filesByDir[dir].push(parts[parts.length - 1]);
  });
  
  Object.keys(filesByDir).sort().forEach(dir => {
    if (dir) {
      printSystem(chalk.white(`├── ${dir}/`));
      filesByDir[dir].forEach(file => {
        printSystem(chalk.white(`│   └── ${file}`));
      });
    } else {
      filesByDir[dir].forEach(file => {
        printSystem(chalk.white(`├── ${file}`));
      });
    }
  });
}

/**
 * Create application files
 */
async function createApplicationFiles(baseDir, folderName, files) {
  const appDir = path.join(baseDir, folderName);
  
  await fs.mkdir(appDir, { recursive: true });
  printSystem(chalk.cyan(`\n📁 Created directory: ${folderName}/`));
  
  for (const file of files) {
    const filePath = path.join(appDir, file.path);
    const fileDir = path.dirname(filePath);
    
    await fs.mkdir(fileDir, { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf8');
    printSystem(chalk.green(`  ✓ ${file.path}`));
  }
  
  return appDir;
}

/**
 * Generate application using structured output
 */
export async function generateApplication(description, aiService, cwd = process.cwd()) {
  try {
    printSystem(chalk.cyan('\n🤖 Agent Mode: Generating your application...\n'));
    printSystem(chalk.gray(`Request: ${description}\n`));
    
    printSystem(chalk.magenta('🤖 Generating structured output...\n'));
    

    const result = await generateObject({
      model: aiService.model,
      schema: ApplicationSchema,
      prompt: `Create a complete, production-ready application for: ${description}
      

CRITICAL REQUIREMENTS:
1. Generate ALL files needed for the application to run
2. Include package.json with ALL dependencies and correct versions (if needed)
3. Include README.md with setup instructions
4. Include configuration files (.gitignore, etc.) if needed
5. Write clean, well-commented, production-ready code
6. Include error handling and input validation
7. Use modern JavaScript/TypeScript best practices
8. Make sure all imports and paths are correct
9. NO PLACEHOLDERS - everything must be complete and working
10. For simple HTML/CSS/JS projects, you can skip package.json if not needed

Provide:
- A meaningful kebab-case folder name
- All necessary files with complete content
- Setup commands (for example: cd folder, npm install, npm run dev OR just open index.html)
- Make it visually appealing and functional`,
      
    });
    
    const application = result.object;
    
    
    printSystem(chalk.green(`\n✅ Generated: ${application.folderName}\n`));
    printSystem(chalk.gray(`Description: ${application.description}\n`));
    
    if (!application.files || application.files.length === 0) {
      throw new Error('No files were generated');
    }
    
    printSystem(chalk.green(`Files: ${application.files.length}\n`));
    
    // Display file tree
    displayFileTree(application.files, application.folderName);
    
    // Create application directory and files
    printSystem(chalk.cyan('\n📝 Creating files...\n'));
    const appDir = await createApplicationFiles(cwd, application.folderName, application.files);
    
    // Display results
    printSystem(chalk.green.bold(`\n✨ Application created successfully!\n`));
    printSystem(chalk.cyan(`📁 Location: ${chalk.bold(appDir)}\n`));
    
    // Display setup commands
    if (application.setupCommands && application.setupCommands.length > 0) {
      printSystem(chalk.cyan('📋 Next Steps:\n'));
      printSystem(chalk.white('```bash'));
      application.setupCommands.forEach(cmd => {
        printSystem(chalk.white(cmd));
      });
      printSystem(chalk.white('```\n'));
    } else {
      printSystem(chalk.yellow('ℹ️  No setup commands provided\n'));
    }
    
    return {
      folderName: application.folderName,
      appDir,
      files: application.files.map(f => f.path),
      commands: application.setupCommands || [],
      success: true,
    };
    
  } catch (err) {
    printSystem(chalk.red(`\n❌ Error generating application: ${err.message}\n`));
    if (err.stack) {
      printSystem(chalk.dim(err.stack + '\n'));
    }
    throw err;
  }
}
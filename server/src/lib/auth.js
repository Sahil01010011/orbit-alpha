import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./db.js";
import { deviceAuthorization } from "better-auth/plugins"; 



export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql", 
    }),
    // baseURL: process.env.BETTER_AUTH_URL,
    basePath:"/api/auth",
    trustedOrigins: ["http://localhost:3000"],
    plugins: [
    deviceAuthorization({ 
      verificationUri: "/device", 
    }), 
  ],
    socialProviders: {
        github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET

        }
    }
});




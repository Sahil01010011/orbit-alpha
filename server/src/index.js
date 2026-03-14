import dotenv from "dotenv"
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import express from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import cors from "cors";
import {auth} from "./lib/auth.js";
import conversationRoutes from "./routes/conversation.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../../.env") });

const app = express();


// CORS configuration
app.use(
  cors({
    origin: "http://localhost:3000", // Replace with your frontend's origin
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"], // Specify allowed HTTP methods
    credentials: true, // Allow credentials (cookies, authorization headers, etc.)
  })
);

app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());

app.use("/api/conversations", conversationRoutes);

app.get("/api/me", async (req, res) => {
 	const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
	return res.json(session);
});

app.get("/device", async (req, res) => { 
  const { user_code } = req.query
  res.redirect(`http://localhost:3000/device?user_code=${user_code}`)

})


app.get("/health", (req, res) => {
    res.send("OK")
})


app.listen(process.env.PORT, () => {
    console.log(`Server started on http://localhost:${process.env.PORT}`);
});

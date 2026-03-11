import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { ChatService } from "../service/chat.service.js";

const router = Router();
const chatService = new ChatService();

/**
 * GET /api/conversations
 * List all conversations for the authenticated user (id, title, mode, createdAt, first message preview).
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const conversations = await chatService.getUserConversations(req.user.id);

    const result = conversations.map((c) => ({
      id: c.id,
      title: c.title,
      mode: c.mode,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      preview: c.messages?.[0]?.content
        ? c.messages[0].content.slice(0, 120)
        : null,
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/conversations/:id
 * Retrieve full message history for a specific conversation owned by the authenticated user.
 */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const conversation = await chatService.getConversationById(
      req.params.id,
      req.user.id
    );

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/conversations/:id
 * Update the title of a conversation owned by the authenticated user.
 * Body: { title: string }
 */
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { title } = req.body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    // Verify ownership before updating
    const existing = await chatService.getConversationById(
      req.params.id,
      req.user.id
    );

    if (!existing) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const updated = await chatService.updateTitle(req.params.id, title.trim());
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

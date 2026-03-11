import prisma from "../lib/db.js";

/**
 * Express middleware that validates the Bearer token sent in the
 * Authorization header and attaches `req.user` for downstream handlers.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.slice(7);

  try {
    const session = await prisma.session.findFirst({
      where: { token },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = session.user;
    next();
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const token = authHeader.split(" ")[1];

    const response = await fetch(
      `${process.env.NHOST_AUTH_URL}/token/verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired token",
      });
    }

    // Decode the JWT payload locally.
    // Signature validity has already been checked by Nhost.
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    );

    req.user = {
      id: payload["https://hasura.io/jwt/claims"]?.["x-hasura-user-id"],
    };

    if (!req.user.id) {
      return res.status(401).json({
        success: false,
        error: "User ID not found in token",
      });
    }

    next();
  } catch (error) {
    console.error("Authentication error:", error);

    return res.status(401).json({
      success: false,
      error: "Authentication failed",
    });
  }
}

module.exports = {
  requireAuth,
};
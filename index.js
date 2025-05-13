// Load environment variables from .env file
require("dotenv").config();
const express = require("express");
const OAuthClient = require("intuit-oauth");
const QuickBooks = require("node-quickbooks");

// Import routes
const invoiceRoutes = require("./routes/invoiceRoutes");

// Initialize an Express application
const app = express();
const port = 3000;

// Add middleware to parse JSON requests
app.use(express.json());

// Configure the OAuthClient with credentials and environment
const oauthClient = new OAuthClient({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  environment: process.env.ENVIRONMENT,
  redirectUri: process.env.REDIRECT_URL,
  logging: true, // Enable OAuth client logging
});

// Log environment configuration
console.log("🚀 Environment Configuration:", {
  environment: process.env.ENVIRONMENT,
  redirectUri: process.env.REDIRECT_URL,
  clientId: process.env.CLIENT_ID ? "Set" : "Not Set",
  clientSecret: process.env.CLIENT_SECRET ? "Set" : "Not Set",
});

// Initialize QuickBooks authentication
const initializeQuickBooks = async () => {
  try {
    console.log("🔄 Initializing QuickBooks authentication...");

    // Generate the authorization URL
    const authUri = oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      state: "randomState",
    });

    console.log("📝 Generated Auth URI:", authUri);
    console.log("⚠️ Please visit the auth endpoint to complete authentication");
    console.log("   GET /auth");
  } catch (error) {
    console.error("❌ Error initializing QuickBooks:", {
      message: error.message,
      originalMessage: error.originalMessage,
      intuit_tid: error.intuit_tid,
    });
  }
};

// Make oauthClient available to routes
app.set("oauthClient", oauthClient);

// Use routes
app.use("/api", invoiceRoutes);

// Authentication endpoint
app.get("/auth", (req, res) => {
  console.log("🔑 Starting OAuth Authentication Flow");

  // Generate authorization URL
  const authUri = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state: "randomState",
  });

  // Redirect to QuickBooks authorization page
  res.redirect(authUri);
});

// Callback endpoint
app.get("/callback", async (req, res) => {
  console.log("🔄 Received OAuth Callback");
  console.log("📥 Callback URL:", req.url);

  try {
    // Exchange the auth code for tokens
    console.log("🔄 Exchanging auth code for tokens...");
    const authResponse = await oauthClient.createToken(req.url);

    console.log("✅ Token Exchange Successful");
    console.log("🔑 Token Response:", {
      realmId: authResponse.getToken().realmId,
      tokenType: authResponse.getToken().token_type,
      expiresIn: authResponse.getToken().expires_in,
    });

    // Store the tokens
    oauthClient.setToken(authResponse.getToken());

    console.log("✅ Tokens stored successfully");
    res.status(200).json({
      success: true,
      message: "Authentication successful",
      realmId: authResponse.getToken().realmId,
    });
  } catch (error) {
    console.error("❌ Error during authentication:", {
      message: error.message,
      originalMessage: error.originalMessage,
      intuit_tid: error.intuit_tid,
    });
    res
      .status(500)
      .json({ error: "Authentication failed", details: error.message });
  }
});

// Route to get all invoices
app.get("/api/invoices", async (req, res) => {
  console.log("📊 Fetching Invoices");

  try {
    // Check if we have valid tokens
    const isTokenValid = oauthClient.isAccessTokenValid();
    console.log("🔑 Token Validation:", { isValid: isTokenValid });

    if (!isTokenValid) {
      console.log("⚠️ Token invalid or expired, redirecting to auth");
      return res.redirect("/auth");
    }

    // Get the tokens
    const authResponse = oauthClient.getToken();
    const { realmId, access_token, refresh_token } = authResponse;

    console.log("🏢 Company ID:", realmId);

    // Initialize QuickBooks client
    const qbo = new QuickBooks(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      access_token,
      false, // no token secret for oAuth 2.0
      realmId,
      process.env.ENVIRONMENT === "sandbox", // use sandbox?
      true, // enable debugging
      null, // minor version
      "2.0", // oauth version
      refresh_token
    );

    console.log("🏢 Making API call to QuickBooks...");

    // Use node-quickbooks to fetch invoices
    qbo.findInvoices(
      {
        fetchAll: true, // Get all invoices
      },
      (err, invoices) => {
        if (err) {
          console.error("❌ Error fetching invoices:", {
            message: err.message,
            intuit_tid: err.intuit_tid,
          });
          return res.status(500).json({ error: "Failed to fetch invoices" });
        }

        console.log("✅ API Call Successful");
        console.log(
          "📦 Number of Invoices:",
          invoices.QueryResponse?.Invoice?.length || 0
        );

        // Return the invoices
        res.json(invoices);
      }
    );
  } catch (error) {
    console.error("❌ Error in invoice route:", {
      message: error.message,
      originalMessage: error.originalMessage,
      intuit_tid: error.intuit_tid,
      authResponse: error.authResponse,
    });

    if (error.authResponse && error.authResponse.status === 401) {
      console.log("⚠️ Unauthorized (401), redirecting to auth");
      return res.redirect("/auth");
    }
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// Start the Express server
app.listen(port, async () => {
  console.log(`🚀 Server started on port: ${port}`);
  console.log("📝 Available endpoints:");
  console.log("   - GET /auth - Start OAuth flow");
  console.log("   - GET /callback - OAuth callback");
  console.log("   - GET /api/invoices - Get all invoices");
  console.log("   - POST /api/invoices/create - Create new invoice");

  // Initialize QuickBooks authentication
  await initializeQuickBooks();
});
